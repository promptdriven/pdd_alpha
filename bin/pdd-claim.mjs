#!/usr/bin/env node
// Generated from prompts/cli/workflow-claims.prompt.md (sha256: 616ba04d175a6bf7ae835b9406ff158d80028ae7ee39d96a92b0339088e8a78e).
import {runWorkflowClaimCommand} from '../src/workflow-claims.mjs';
const result=await runWorkflowClaimCommand(process.argv.slice(2));
if(result.code==='unsupported')process.stderr.write('Session claims require the installed Mac/Linux pdd-flock helper.\n');
if(result.code==='bad_arguments')process.stderr.write('Usage: pdd-claim codex|claude:SESSION_ID -- CLI ARGS…\n');
process.exitCode=result.exitCode;
