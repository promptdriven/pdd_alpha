import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign,verify,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildBootstrap} from '../../launcher/build-bootstrap.mjs';
import {directoryDigest} from '../../src/owned-node.mjs';
const execute=promisify(execFile);
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'pdd-custody-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const asset={url:'https://release.invalid/alpha',sha256:'a'.repeat(64),integrity:'sha512-synthetic',provenance:'offline synthetic'};
  const descriptor={releaseId:'staging-test',pddVersion:'1.0.0',environment:'staging',keyId:'staging-test-key',alpha:asset,nodes:{'linux-x64':{...asset,version:'22.16.0'}}};
  const descriptorBytes=Buffer.from(JSON.stringify(descriptor,null,3)+'\n\n');
  const publicTrust={environment:'staging',keyId:descriptor.keyId,publicKeyPem:publicKey.export({format:'pem',type:'spki'}).toString()};
  const signature=sign(null,descriptorBytes,privateKey).toString('base64url');
  const custody={descriptorBytes,signature,publicTrust},destination=join(root,'install.sh');
  const stage=join(root,'stage');await fs.mkdir(stage);await fs.mkdir(join(stage,'alpha'),{mode:0o700});
  return {root,stage,descriptor,custody,destination,publicKey,privateKey};
}
// Execute only the actual generated custody block in disposable extraction
// directories. No installer entry, download, runtime activation or service runs.
async function stageCustody(f){
  const script=await fs.readFile(f.destination,'utf8');
  const assignments=['pdd_trust_descriptor','pdd_trust_signature','pdd_trust_root'].map(name=>{const line=script.split('\n').find(l=>l.startsWith(name+'='));assert.ok(line);return line;}).join('\n');
  const helper=script.slice(script.indexOf('pdd_enter_private() {'),script.indexOf('# This traversal'));
  const block=script.slice(script.indexOf('  # Begin signed release custody:'),script.indexOf('  # End signed release custody.'));
  assert.ok(helper.includes('pdd_enter_private'));assert.ok(block.includes('descriptor.json'));
  return execute('/bin/sh',['-c','set -eu\numask 077\npdd_bootstrap_fail() { printf "%s\\n" "$1" >&2; exit 1; }\npdd_directory=$PWD\n'+assignments+'\n'+helper+'\n'+block],{cwd:f.stage,env:{PATH:'/usr/bin:/bin'},timeout:10000});
}
test('signed custody retains exact bytes and public root inside the immutable tree digest',async t=>{
  const f=await fixture(t);await buildBootstrap(f);await stageCustody(f);
  const alpha=join(f.stage,'alpha'),trust=join(alpha,'trust');assert.equal((await fs.stat(trust)).mode&0o777,0o700);
  for(const name of ['descriptor.json','descriptor.sig','release-root.json'])assert.equal((await fs.stat(join(trust,name))).mode&0o777,0o600);
  assert.deepEqual(await fs.readFile(join(trust,'descriptor.json')),f.custody.descriptorBytes);
  assert.equal(await fs.readFile(join(trust,'descriptor.sig'),'utf8'),f.custody.signature+'\n');
  const root=JSON.parse(await fs.readFile(join(trust,'release-root.json')));
  assert.deepEqual(root,{schema:'pdd/staging-release-root/v1',purpose:'u4-user-release-root',environment:'staging',keyId:'staging-test-key',algorithm:'Ed25519',publicKeyPem:f.custody.publicTrust.publicKeyPem,publicKeyDerSha256:createHash('sha256').update(f.publicKey.export({format:'der',type:'spki'})).digest('hex')});
  assert.equal(verify(null,await fs.readFile(join(trust,'descriptor.json')),f.publicKey,Buffer.from(f.custody.signature,'base64url')),true);
  const digest=await directoryDigest(alpha),retained=join(f.root,'retained');await fs.rename(alpha,retained);
  assert.equal(await directoryDigest(retained),digest);
  await fs.appendFile(join(retained,'trust/descriptor.json'),' ');assert.notEqual(await directoryDigest(retained),digest);
});
test('custody refuses an existing archive directory without overwriting its files',async t=>{
  const f=await fixture(t),trust=join(f.stage,'alpha/trust');await fs.mkdir(trust);await fs.writeFile(join(trust,'descriptor.json'),'original');
  await buildBootstrap(f);await assert.rejects(stageCustody(f),e=>e.code===1&&e.stderr.includes('already exists'));
  assert.equal(await fs.readFile(join(trust,'descriptor.json'),'utf8'),'original');assert.deepEqual(await fs.readdir(trust),['descriptor.json']);
});
test('custody refuses a symlink and leaves the outside target bytes and mode unchanged',async t=>{
  const f=await fixture(t),outside=join(f.root,'outside');await fs.mkdir(outside);await fs.chmod(outside,0o775);await fs.writeFile(join(outside,'sentinel'),'unchanged');
  await fs.symlink(outside,join(f.stage,'alpha/trust'));await buildBootstrap(f);
  await assert.rejects(stageCustody(f),e=>e.code===1);assert.deepEqual(await fs.readdir(outside),['sentinel']);assert.equal(await fs.readFile(join(outside,'sentinel'),'utf8'),'unchanged');assert.equal((await fs.stat(outside)).mode&0o777,0o775);
});
test('legacy bootstrap without signed custody creates no trust path',async t=>{
  const f=await fixture(t);await buildBootstrap({descriptor:f.descriptor,destination:f.destination});await stageCustody(f);
  await assert.rejects(fs.access(join(f.stage,'alpha/trust')),{code:'ENOENT'});
});
test('changed signed bytes wrong root private PEM and different table refuse before generation',async t=>{
  const f=await fixture(t),other=generateKeyPairSync('ed25519');
  const variants=[{...f.custody,descriptorBytes:Buffer.concat([f.custody.descriptorBytes,Buffer.from(' ')])},
    {...f.custody,signature:sign(null,f.custody.descriptorBytes,other.privateKey).toString('base64url')},
    {...f.custody,publicTrust:{...f.custody.publicTrust,publicKeyPem:f.privateKey.export({format:'pem',type:'pkcs8'}).toString()}},
    {...f.custody,publicTrust:{...f.custody.publicTrust,environment:'lab'}}];
  for(const custody of variants){await assert.rejects(buildBootstrap({...f,custody}),/Verified signed staging custody required/);await assert.rejects(fs.access(f.destination),{code:'ENOENT'});}
  await assert.rejects(buildBootstrap({...f,descriptor:{...f.descriptor,releaseId:'another'}}),/Verified signed staging custody required/);
  await assert.rejects(fs.access(f.destination),{code:'ENOENT'});
});
