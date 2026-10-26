// Generated from prompts/cli/bootstrap.prompt.md (sha256: 7b07a734be0f15fca1a6457f5dd15f3374d9bd60fa8baf0f6b8eba97b4e90b09).
// Release tooling only: the caller supplies already reviewed, immutable inputs.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createPublicKey, verify } from 'node:crypto';
export async function buildBootstrap({ descriptor, destination, custody }) {
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  const supportedNode = value => {
    if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) return false;
    const [major, minor] = value.split('.').map(Number);
    return major > 22 || major === 22 && minor >= 16;
  };
  const validAsset = asset => asset?.url?.startsWith('https://') && /^[a-f0-9]{64}$/.test(asset.sha256 ?? '') && typeof asset.integrity === 'string' && asset.provenance;
  if (!safeId(descriptor?.releaseId) || typeof descriptor.pddVersion !== 'string' || !descriptor.pddVersion || !validAsset(descriptor.alpha) || !descriptor.nodes) throw new TypeError('Trusted immutable release descriptor required');
  if (descriptor.client !== undefined && (!custody || descriptor.client?.path !== 'client' || descriptor.client.algorithm !== 'pdd-directory-sha256-v1' || !/^[a-f0-9]{64}$/.test(descriptor.client.digest ?? '') || Object.keys(descriptor.client).sort().join(',') !== 'algorithm,digest,path')) throw new TypeError('Verified signed client digest required');
  const rows = [];
  const encoded = JSON.stringify(descriptor);
  if (/[|'\r\n]/.test(encoded)) throw new TypeError('Release descriptor is not representable in the bootstrap table');
  for (const [key, node] of Object.entries(descriptor.nodes)) {
    const match = /^(linux|darwin)-(x64|arm64)$/.exec(key);
    if (!match || !validAsset(node) || !supportedNode(node.version)) throw new TypeError('Verified platform Node required');
    rows.push([match[1], match[2], node.version, node.url, node.sha256, descriptor.alpha.url, descriptor.alpha.sha256, encoded].join('|'));
  }
  if (!rows.length) throw new TypeError('No runtime artifacts');
  let custodyDescriptor = '', custodySignature = '', custodyRoot = '';
  if (custody !== undefined) {
    try {
      const {descriptorBytes, signature, publicTrust} = custody;
      if (!Buffer.isBuffer(descriptorBytes) || JSON.stringify(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(descriptorBytes))) !== encoded ||
          descriptor.environment !== 'staging' || publicTrust?.environment !== 'staging' || publicTrust.keyId !== descriptor.keyId ||
          !safeId(publicTrust.keyId) || !/staging/i.test(publicTrust.keyId) || /lab/i.test(publicTrust.keyId) ||
          typeof publicTrust.publicKeyPem !== 'string' || !/^\s*-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----\s*$/.test(publicTrust.publicKeyPem) ||
          typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature) || Buffer.from(signature, 'base64url').toString('base64url') !== signature) throw new Error();
      const key = createPublicKey({key: publicTrust.publicKeyPem, format: 'pem', type: 'spki'});
      if (key.asymmetricKeyType !== 'ed25519' || !verify(null, descriptorBytes, key, Buffer.from(signature, 'base64url'))) throw new Error();
      const root = {schema: 'pdd/staging-release-root/v1', purpose: 'u4-user-release-root', environment: 'staging', keyId: publicTrust.keyId, algorithm: 'Ed25519', publicKeyPem: key.export({type: 'spki', format: 'pem'}).toString(),
        publicKeyDerSha256: createHash('sha256').update(key.export({type: 'spki', format: 'der'})).digest('hex')};
      custodyDescriptor = descriptorBytes.toString('base64'); custodySignature = signature;
      custodyRoot = Buffer.from(JSON.stringify(root, null, 2)+'\n').toString('base64');
    } catch { throw new TypeError('Verified signed staging custody required'); }
  }
  const template = await readFile(new URL('../install.sh', import.meta.url), 'utf8');
  const migration = await readFile(new URL('./migrate-r-line.sh', import.meta.url), 'utf8');
  const cleanup = await readFile(new URL('./npm-cleanup.mjs', import.meta.url), 'utf8');
  const cleanupScript = cleanup + '\ntry { await cleanupLegacyNpm(); } catch { process.exitCode = 1; }\n';
  const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const installer = template.replace("pdd_release_table='__PDD_RELEASE_TABLE__'", `pdd_release_table='${rows.join('\n')}'`)
    .replace("pdd_trust_descriptor='__PDD_TRUST_DESCRIPTOR__'", () => `pdd_trust_descriptor='${custodyDescriptor}'`)
    .replace("pdd_trust_signature='__PDD_TRUST_SIGNATURE__'", () => `pdd_trust_signature='${custodySignature}'`)
    .replace("pdd_trust_root='__PDD_TRUST_ROOT__'", () => `pdd_trust_root='${custodyRoot}'`)
    .replace("pdd_r_line_move='__PDD_R_LINE_MOVE__'", () => `pdd_r_line_move=${quote(migration)}`)
    .replace("pdd_npm_cleanup='__PDD_NPM_CLEANUP__'", () => `pdd_npm_cleanup=${quote(cleanupScript)}`);
  await writeFile(destination, installer, { mode: 0o755, flag: 'wx' });
}
