'use client';
import { useEffect, useState } from 'react';
import { AUTHORSHIP_TERMS, AUTHORSHIP_VERSION } from '@praxis/shared';
import { call } from '@/lib/client';
export function AuthoringConsent({taskId,readOnly,onReady}:{taskId:string;readOnly:boolean;onReady():void}) {
  const [checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <section className="my-4 space-y-3 rounded border border-line p-4"><h2 className="font-semibold">Human-authorship agreement</h2><p className="text-sm">{AUTHORSHIP_TERMS}</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} disabled={readOnly||busy} onChange={e=>setChecked(e.target.checked)}/>I agree to these terms.</label><button disabled={!checked||busy||readOnly} className="rounded border border-line p-2 disabled:opacity-50" onClick={async()=>{setBusy(true);const r=await call('POST',`/me/tasks/${taskId}/conversation/consent`,{version:AUTHORSHIP_VERSION,accepted:true});setBusy(false);if(r.ok)onReady();else setError(r.error??'Could not accept terms');}}>Accept authorship terms</button>{error&&<p role="alert">{error}</p>}</section>;
}
