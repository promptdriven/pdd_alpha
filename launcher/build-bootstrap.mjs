// Generated from prompts/cli/bootstrap.prompt.md (sha256: b4716bbd06c91a122df8403b0cf352e4676439489aa53c59ee394a492594f45b).
// Release tooling only: the caller supplies already reviewed, immutable inputs.
import { readFile, writeFile } from 'node:fs/promises';
export async function buildBootstrap({ descriptor, destination }) {
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  const supportedNode = value => {
    if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) return false;
    const [major, minor] = value.split('.').map(Number);
    return major > 22 || major === 22 && minor >= 16;
  };
  const validAsset = asset => asset?.url?.startsWith('https://') && /^[a-f0-9]{64}$/.test(asset.sha256 ?? '') && typeof asset.integrity === 'string' && asset.provenance;
  if (!safeId(descriptor?.releaseId) || typeof descriptor.pddVersion !== 'string' || !descriptor.pddVersion || !validAsset(descriptor.alpha) || !descriptor.nodes) throw new TypeError('Trusted immutable release descriptor required');
  const rows = [];
  const encoded = JSON.stringify(descriptor);
  if (/[|'\r\n]/.test(encoded)) throw new TypeError('Release descriptor is not representable in the bootstrap table');
  for (const [key, node] of Object.entries(descriptor.nodes)) {
    const match = /^(linux|darwin)-(x64|arm64)$/.exec(key);
    if (!match || !validAsset(node) || !supportedNode(node.version)) throw new TypeError('Verified platform Node required');
    rows.push([match[1], match[2], node.version, node.url, node.sha256, descriptor.alpha.url, descriptor.alpha.sha256, encoded].join('|'));
  }
  if (!rows.length) throw new TypeError('No runtime artifacts');
  const template = await readFile(new URL('../install.sh', import.meta.url), 'utf8');
  await writeFile(destination, template.replace("pdd_release_table='__PDD_RELEASE_TABLE__'", `pdd_release_table='${rows.join('\n')}'`), { mode: 0o755, flag: 'wx' });
}
