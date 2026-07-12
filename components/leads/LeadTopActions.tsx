'use client'
import { Button } from '@/components/ui/button'
export function LeadTopActions({busy,intakeSent,onIntake,onDraft,onConvert}:{busy:boolean;intakeSent:boolean;onIntake:()=>void;onDraft:()=>void;onConvert:()=>void}){return <div className="flex flex-wrap gap-2"><Button onClick={onIntake} disabled={busy}>{intakeSent?'Resend intake':'Send intake'}</Button><Button variant="outline" onClick={onDraft} disabled={busy}>Draft engagement</Button><Button variant="outline" onClick={onConvert} disabled={busy}>Convert matter</Button></div>}
