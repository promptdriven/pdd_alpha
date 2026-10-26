import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const script=fileURLToPath(new URL('../../launcher/migrate-r-line.sh',import.meta.url));
for (const protectedDirectory of [false,true]) test(protectedDirectory?'ZDOTDIR in native Claude directory must remain unchanged':'ordinary ZDOTDIR migration still edits its exact old PATH line',async t=>{
 const root=await mkdtemp(join(tmpdir(),'r2-migration-profile-')),home=join(root,'home'),backup=join(root,'backup');
 t.after(()=>rm(root,{recursive:true,force:true}));
 const zdot=join(home,protectedDirectory?'.claude':'dotfiles');await mkdir(zdot,{recursive:true});await mkdir(backup);
 const target=join(zdot,'.zshrc'),before='export PATH="$HOME/.local/bin:$HOME/pocket/bin:$PATH"\n# retained configuration\n';await writeFile(target,before);
 const code=`set -eu
source "$PDD_REVIEW_SCRIPT"
BACKUP="$PDD_TEST_BACKUP"
POCKET="$HOME/pocket"
LBIN="$HOME/.local/bin"
LA="$HOME/Library/LaunchAgents"
FISH_DIR="$HOME/.config/fish"
REGISTRY="$POCKET/state/registry.json"
APP_BUNDLE="$POCKET/PDD Session Links.app"
CODEX_WANT="$POCKET/codex/default"
UID_NUM=$(id -u)
MODE=apply
# Only external process/service observations are suppressed; discovery,
# target selection, real-directory checks and profile editing are production.
ps_all() { :; }
discover_systemd() { SD_OK=no; T_UNITS=; }
check_real_dirs
discover
printf '%s\n' "$T_PROFILES"
step_shell_path
`;
 const r=spawnSync('/bin/bash',['-c',code],{encoding:'utf8',timeout:10000,env:{HOME:home,ZDOTDIR:zdot,PATH:'/usr/bin:/bin',PDD_MOVE_LIB_ONLY:'1',PDD_REVIEW_SCRIPT:script,PDD_TEST_BACKUP:backup}});
 assert.equal(r.status,0,r.stderr);assert.ok(r.stdout.includes(target),'production discovery must select the profile');
 const after=await readFile(target,'utf8');assert.equal(after,protectedDirectory?before:'export PATH="$HOME/.local/bin:$PATH"\n# retained configuration\n');
});

for(const native of ['.claude','.codex','alias','alias-dotdot'])for(const invocation of ['step-apply','step-dry','direct'])test(`protected ${native} profile refuses ${invocation} without backup or state changes`,async t=>{
 const {stat,readdir,symlink}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'pdd-native-profile-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const home=join(root,'home'),backup=join(root,'backup'),nativeDir=join(home,native.startsWith('alias')?'.claude':native);
 await mkdir(nativeDir,{recursive:true});await mkdir(backup);
 const alias=join(home,'dotfiles'),zdot=native==='alias-dotdot'?alias+'/..':native==='alias'?alias:nativeDir;
 if(native==='alias-dotdot'){await mkdir(join(nativeDir,'subdirectory'));await symlink(join(nativeDir,'subdirectory'),alias);}
 else if(native==='alias')await symlink(nativeDir,alias);
 const target=join(nativeDir,'.zshrc'),content='export PATH="$HOME/.local/bin:$HOME/pocket/bin:$PATH"\n# native retained\n';
 await writeFile(target,content,{mode:0o600});
 const before=await stat(target),dirBefore=await stat(nativeDir);
 const code=`set -eu
source "$PDD_REVIEW_SCRIPT"
BACKUP="$PDD_TEST_BACKUP"
MODE="$PDD_TEST_MODE"
T_FISH=
T_PROFILES="$ZDOTDIR/.zshrc$TAB"sh"$TAB"1
T_PROFILE_MENTION=
if [ "$PDD_TEST_DIRECT" = yes ]; then edit_profile "$ZDOTDIR/.zshrc" sh; else step_shell_path; fi
[ -n "$FAIL_LIST" ]
if [ "$MODE" = dry ]; then [ -n "$WOULD_REFUSE" ]; fi
`;
 const result=spawnSync('/bin/bash',['-c',code],{encoding:'utf8',timeout:10000,env:{HOME:home,ZDOTDIR:zdot,PATH:'/usr/bin:/bin',PDD_MOVE_LIB_ONLY:'1',PDD_REVIEW_SCRIPT:script,PDD_TEST_BACKUP:backup,PDD_TEST_MODE:invocation==='step-dry'?'dry':'apply',PDD_TEST_DIRECT:invocation==='direct'?'yes':'no'}});
 assert.equal(result.status,0,result.stderr);assert.match(invocation==='step-dry'?result.stderr:result.stdout,/protected or unresolved profile/);
 assert.equal(await readFile(target,'utf8'),content);
 const after=await stat(target),dirAfter=await stat(nativeDir);
 for(const k of ['ino','mode','mtimeMs']){assert.equal(after[k],before[k]);assert.equal(dirAfter[k],dirBefore[k]);}
 assert.deepEqual((await readdir(nativeDir)).sort(),native==='alias-dotdot'?['.zshrc','subdirectory']:['.zshrc']);assert.deepEqual(await readdir(backup),[]);
});

for(const aliasParent of [false,true])test(aliasParent?'physical alias followed by dot-dot refuses real discovery and dry-run before migration':'protected native profile makes the real dry-run orchestration refuse before migration steps',async t=>{
 const {readdir,symlink}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'pdd-native-dry-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const home=join(root,'home'),zdot=join(home,'.claude');await mkdir(zdot,{recursive:true});
 const alias=join(home,'dotfiles');
 if(aliasParent){await mkdir(join(zdot,'subdirectory'));await symlink(join(zdot,'subdirectory'),alias);}
 const target=join(zdot,'.zshrc'),content='export PATH="$HOME/.local/bin:$HOME/pocket/bin:$PATH"\n';await writeFile(target,content);
 const code=`set -eu
source "$PDD_REVIEW_SCRIPT"
POCKET="$HOME/pocket"; LBIN="$HOME/.local/bin"; LA="$HOME/Library/LaunchAgents"
FISH_DIR="$HOME/.config/fish"; REGISTRY="$POCKET/state/registry.json"
APP_BUNDLE="$POCKET/PDD Session Links.app"; CODEX_WANT="$POCKET/codex/default"
UID_NUM=$(id -u); USER_NAME=synthetic; MODE=dry
ps_all() { :; }
discover_systemd() { SD_OK=no; T_UNITS=; }
do_apply
`;
 const r=spawnSync('/bin/bash',['-c',code],{encoding:'utf8',timeout:10000,env:{HOME:home,ZDOTDIR:aliasParent?alias+'/..':zdot,PATH:'/usr/bin:/bin',PDD_MOVE_LIB_ONLY:'1',PDD_REVIEW_SCRIPT:script}});
 assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/real run would refuse:.*protected or unresolved profile/);
 assert.equal(await readFile(target,'utf8'),content);assert.deepEqual((await readdir(home)).sort(),aliasParent?['.claude','dotfiles']:['.claude']);assert.deepEqual((await readdir(zdot)).sort(),aliasParent?['.zshrc','subdirectory']:['.zshrc']);
});

test('profile directory alias followed by dot-dot must preserve physical native profile',async t=>{
 const root=await mkdtemp(join(tmpdir(),'r3-native-parent-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const home=join(root,'home'),native=join(home,'.claude'),backup=join(root,'backup');
 await mkdir(join(native,'subdirectory'),{recursive:true});await mkdir(backup);
 const alias=join(home,'dotfiles');await (await import('node:fs/promises')).symlink(join(native,'subdirectory'),alias);
 const target=join(native,'.zshrc'),before='export PATH="$HOME/.local/bin:$HOME/pocket/bin:$PATH"\n# retained native configuration\n';
 await writeFile(target,before,{mode:0o600});
 const code=`set -eu
source "$PDD_REVIEW_SCRIPT"
BACKUP="$PDD_TEST_BACKUP"
MODE=apply
edit_profile "$ZDOTDIR/.zshrc" sh
`;
 const result=spawnSync('/bin/bash',['-c',code],{encoding:'utf8',timeout:10000,env:{HOME:home,ZDOTDIR:alias+'/..',PATH:'/usr/bin:/bin',PDD_MOVE_LIB_ONLY:'1',PDD_REVIEW_SCRIPT:script,PDD_TEST_BACKUP:backup}});
 const {readdir}=await import('node:fs/promises');
 const after=await readFile(target,'utf8');
 console.log(JSON.stringify({exit:result.status,stdout:result.stdout,stderr:result.stderr,before,after,nativeEntries:await readdir(native)}));
 assert.equal(after,before,'physical ~/.claude profile must remain byte-identical');
 assert.deepEqual((await readdir(native)).sort(),['.zshrc','subdirectory']);assert.deepEqual(await readdir(backup),[]);
});
