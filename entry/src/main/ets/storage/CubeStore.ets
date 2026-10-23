import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

const PREFERENCES_NAME: string = 'cube_store';
const SETTINGS_KEY: string = 'settings';
const RECORDS_KEY: string = 'records';
const MAX_RECORDS: number = 200;

export class CubeSettings {
  defaultOrder: number = 3;
  speed: number = 1;
  sound: boolean = true;
  haptics: boolean = true;
  beginnerGuides: boolean = true;
}

export class SolveRecord {
  order: number;
  durationMs: number;
  moves: number;
  date: number;

  constructor(order: number, durationMs: number, moves: number, date: number = Date.now()) {
    this.order = order;
    this.durationMs = durationMs;
    this.moves = moves;
    this.date = date;
  }
}

function isValidOrder(order: number): boolean {
  return typeof order === 'number' && Number.isInteger(order) && order >= 2 && order <= 5;
}

function isValidSettings(settings: CubeSettings): boolean {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return false;
  }
  return isValidOrder(settings.defaultOrder) &&
    typeof settings.speed === 'number' && Number.isFinite(settings.speed) &&
    settings.speed >= 0.5 && settings.speed <= 2 &&
    typeof settings.sound === 'boolean' && typeof settings.haptics === 'boolean' &&
    (settings.beginnerGuides === undefined || typeof settings.beginnerGuides === 'boolean');
}

function isValidRecord(record: SolveRecord): boolean {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }
  return isValidOrder(record.order) &&
    typeof record.durationMs === 'number' && Number.isFinite(record.durationMs) &&
    record.durationMs >= 0 &&
    typeof record.moves === 'number' && Number.isSafeInteger(record.moves) && record.moves >= 0 &&
    typeof record.date === 'number' && Number.isSafeInteger(record.date) && record.date >= 0;
}

function copySettings(settings: CubeSettings): CubeSettings {
  const copy = new CubeSettings();
  copy.defaultOrder = settings.defaultOrder;
  copy.speed = settings.speed;
  copy.sound = settings.sound;
  copy.haptics = settings.haptics;
  // Older preferences predate beginner guides; keep their other choices intact.
  copy.beginnerGuides = settings.beginnerGuides === undefined ? true : settings.beginnerGuides;
  return copy;
}

function copyRecord(record: SolveRecord): SolveRecord {
  return new SolveRecord(record.order, record.durationMs, record.moves, record.date);
}

function decodeSettings(value: string): CubeSettings {
  try {
    const parsed = JSON.parse(value) as CubeSettings;
    if (isValidSettings(parsed)) {
      return copySettings(parsed);
    }
  } catch {
    // Only malformed stored JSON is recovered here, never storage I/O errors.
  }
  return new CubeSettings();
}

function decodeRecords(value: string): SolveRecord[] {
  try {
    const parsed = JSON.parse(value) as SolveRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const records: SolveRecord[] = [];
    for (let index = 0; index < parsed.length; index++) {
      const record: SolveRecord = parsed[index];
      if (!isValidRecord(record)) {
        return [];
      }
      records.push(copyRecord(record));
    }
    records.sort((left: SolveRecord, right: SolveRecord): number => right.date - left.date);
    return records.slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

export class CubeStore {
  public settings: CubeSettings = new CubeSettings();
  // Newest first. The UI displays records.slice(0, 20); storage retains up to 200.
  public records: SolveRecord[] = [];

  private storage: preferences.Preferences | undefined = undefined;
  private pending: Promise<void> = Promise.resolve();

  public async load(context: common.UIAbilityContext): Promise<void> {
    return this.enqueue(async (): Promise<void> => {
      const storage = await preferences.getPreferences(context, { name: PREFERENCES_NAME });
      const settingsValue = await storage.get(SETTINGS_KEY, '');
      const recordsValue = await storage.get(RECORDS_KEY, '');
      const settings: CubeSettings = typeof settingsValue === 'string' ?
        decodeSettings(settingsValue) : new CubeSettings();
      const records: SolveRecord[] = typeof recordsValue === 'string' ?
        decodeRecords(recordsValue) : [];
      this.storage = storage;
      this.settings = settings;
      this.records = records;
    });
  }

  public async saveSettings(settings: CubeSettings): Promise<void> {
    if (!isValidSettings(settings)) {
      throw new Error('Invalid cube settings. Order must be 2–5 and speed must be 0.5–2.');
    }
    const snapshot = copySettings(settings);
    return this.enqueue(async (): Promise<void> => {
      const storage = this.requireStorage();
      await storage.put(SETTINGS_KEY, JSON.stringify(snapshot));
      await storage.flush();
      this.settings = snapshot;
    });
  }

  public async addRecord(record: SolveRecord): Promise<void> {
    if (!isValidRecord(record)) {
      throw new Error('Invalid solve record. Check order, durationMs, moves and date.');
    }
    const snapshot = copyRecord(record);
    return this.enqueue(async (): Promise<void> => {
      const storage = this.requireStorage();
      const records: SolveRecord[] = this.records.slice();
      records.unshift(snapshot);
      records.sort((left: SolveRecord, right: SolveRecord): number => right.date - left.date);
      const retained: SolveRecord[] = records.slice(0, MAX_RECORDS);
      await storage.put(RECORDS_KEY, JSON.stringify(retained));
      await storage.flush();
      this.records = retained;
    });
  }

  public async clearRecords(): Promise<void> {
    return this.enqueue(async (): Promise<void> => {
      const storage = this.requireStorage();
      await storage.put(RECORDS_KEY, '[]');
      await storage.flush();
      this.records = [];
    });
  }

  private requireStorage(): preferences.Preferences {
    const storage = this.storage;
    if (storage === undefined) {
      throw new Error('CubeStore is not loaded. Await load(context) before saving.');
    }
    return storage;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    // Each caller receives its own rejection. A failed operation does not block later calls.
    const result: Promise<void> = this.pending.then(operation, operation);
    this.pending = result;
    return result;
  }
}

export default CubeStore;
