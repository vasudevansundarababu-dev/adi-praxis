import {describe,it,expect} from 'vitest';
import {authoredChangeProblems,facilitatorQuestion,generationRequest} from '../src/tasks/conversation/authorship';
import type {ConversationProposal} from '@praxis/shared';
const p=(value:unknown):ConversationProposal=>({reply:'ignored',question:'ignored',changes:[{section:'solution',value,reason:'ignored'}],ruleLinks:[],unresolved:[]});
describe('human-only authoring controls',()=>{
 it('blocks generated reference answers not written by the SME',()=>{expect(authoredChangeProblems({},p({rationale:'Approve because the documents are verified'}),['Tax ID is missing']).length).toBeGreaterThan(0);});
 it('extracts exact typed content while preserving existing content',()=>{expect(authoredChangeProblems({solution:{rationale:'Existing rationale.'}},p({rationale:'Existing rationale. Missing evidence remains pending.'}),['Missing evidence remains pending.'])).toEqual([]);});
 it('requires explicit numerical weights and critical flags',()=>{expect(authoredChangeProblems({},p({riskFactors:['Medium'],score:80,critical:true}),['Medium']).length).toBe(2);});
 it('refuses writing requests and unrelated common queries',()=>{expect(generationRequest('Generate the correct answer for me')).toBe(true);expect(generationRequest('write a poem')).toBe(true);expect(generationRequest('What is the weather?')).toBe(true);});
 it('returns a task question rather than forwarding a model answer',()=>{expect(facilitatorQuestion('SSN is absent',{},'KYC')).toContain('approved project rule');expect(facilitatorQuestion('unrelated question',{},'Marketing')).toContain('Marketing case');});
});
