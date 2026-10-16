// -----------------------------------------------------------------------------
// What survives a restart, in /data (the only writable folder): the state of
// each account learned from its events (SIA never sends a full state), the
// channel token and the fingerprint of the receiver's environment. Written
// whole to a temporary file, then renamed: never half-written.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class StateStore {
  constructor(file = '/data/ajax-state.json') {
    this.file = file;
  }

  /** The saved data, `{}` when there is none or it cannot be read. */
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  async save(data) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(data));
    await rename(temporary, this.file);
  }
}
