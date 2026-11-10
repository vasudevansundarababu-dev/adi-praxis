'use client';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
/** UX deterrent, not proof of human authorship. Upload controls and document viewing remain available. */
export function TypedAnswerBoundary({ children, enabled=true }: { children: ReactNode; enabled?: boolean }) {
  const [notice,setNotice]=useState('');
  const editable=(target:EventTarget|null)=>target instanceof Element && !!target.closest('textarea,input:not([type="file"]):not([type="checkbox"]):not([type="radio"]),[contenteditable="true"]');
  const block=(e:SyntheticEvent)=>{if(enabled && editable(e.target)){e.preventDefault();setNotice('Please type your own answer. Paste, cut and text drop are disabled in authoring fields. Authorised document uploads remain available.');}};
  return <div onPasteCapture={block} onCutCapture={block} onDropCapture={block} onBeforeInputCapture={e=>{const type=(e.nativeEvent as InputEvent).inputType;if(type==='insertFromPaste'||type==='insertFromDrop')block(e);}}>{notice&&<p role="status" className="mb-3 rounded border border-line p-3 text-sm">{notice}</p>}{children}</div>;
}
