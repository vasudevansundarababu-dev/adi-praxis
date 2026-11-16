import { GcsStorage, type SignedUrlStorage } from '../../candidate/storage';
import type { Config } from '../../config';
import type { EventHandler } from '../../outbox/handlers';
import { GeminiTutorialScriptDrafter, MockTutorialScriptDrafter } from './script';
import { executeTutorialRun, type TutorialPipeline, type TutorialSettings } from './service';
import { FfmpegStitcher, MockStitcher } from './stitch';
import { CloudTextToSpeech, MockNarration } from './tts';
import { MockClipGenerator, VertexVeoClipGenerator } from './veo';

export * from './service';

/** Read through to the config, so the routes, publish and the worker always agree. */
export const tutorialSettings = (config: Config): TutorialSettings => ({
  get tutorial() {
    return config.tutorial;
  },
  get appEnv() {
    return config.appEnv;
  },
});

/** The private bucket for generated videos (the emulator locally). */
export function defaultTutorialStorage(config: Config): SignedUrlStorage {
  return new GcsStorage(config.tutorial.bucket, config.GCS_EMULATOR_HOST ? { apiEndpoint: config.GCS_EMULATOR_HOST, projectId: config.GCS_PROJECT_ID } : {});
}

/** Live Gemini, Veo, Text-to-Speech and ffmpeg only with TUTORIAL_VIDEO_LIVE (never in tests); otherwise the mocks. */
export function defaultTutorialPipeline(config: Config, storage: SignedUrlStorage = defaultTutorialStorage(config)): TutorialPipeline {
  const settings = tutorialSettings(config);
  if (!config.tutorial.live) return { script: new MockTutorialScriptDrafter(), clips: new MockClipGenerator(), narration: new MockNarration(), stitcher: new MockStitcher(), storage, settings };
  const projectId = config.VERTEX_PROJECT_ID;
  return {
    script: new GeminiTutorialScriptDrafter(config.tutorial.scriptModel, { projectId, location: config.VERTEX_LOCATION }),
    clips: new VertexVeoClipGenerator(config.tutorial.veoModel, { projectId, location: config.tutorial.veoLocation }),
    narration: new CloudTextToSpeech(config.tutorial.ttsVoice, { projectId }),
    stitcher: new FfmpegStitcher(),
    storage,
    settings,
  };
}

/** Outbox handler: slow work outside a transaction; the run claims itself, so a redelivery does nothing. */
export function tutorialVideoHandler(pipeline: TutorialPipeline): EventHandler {
  return {
    name: 'template.tutorial_video',
    event: 'template.tutorial_requested',
    async run(event, db) {
      await executeTutorialRun(db, pipeline, (event.payload as { runId: string }).runId);
    },
  };
}
