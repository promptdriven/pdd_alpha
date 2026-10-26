#!/usr/bin/env node
// Generated from prompts/cli/workflow-claims.prompt.md (sha256: 3d61ef638c783860141df891b7dd91f8f8da4a7b3b980e3f41b129f4bed046c4).
import {runWorkflowClaimCommand} from '../src/workflow-claims.mjs';
const result=await runWorkflowClaimCommand(process.argv.slice(2));
if(result.code==='unsupported')process.stderr.write('Session claims require the installed Mac/Linux pdd-flock helper.\n');
if(result.code==='bad_arguments')process.stderr.write('Usage: pdd-claim codex|claude:SESSION_ID -- CLI ARGS…\n');
process.exitCode=result.exitCode;
