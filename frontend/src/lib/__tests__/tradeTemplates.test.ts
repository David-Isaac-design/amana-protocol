import { loadTemplates, saveTemplate, deleteTemplate } from '../tradeTemplates';
import type { TradeData } from '@/app/trades/create/TradeContext';

// In-memory localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

const sampleData: Partial<TradeData> = {
  commodity: 'Maize',
  quantity: '500',
  unit: 'kg',
  pricePerUnit: '450',
  currency: 'NGN',
};

beforeEach(() => {
  localStorageMock.clear();
});

describe('tradeTemplates', () => {
  describe('loadTemplates', () => {
    it('returns [] when localStorage is empty', () => {
      const templates = loadTemplates();
      expect(templates).toEqual([]);
    });

    it('returns [] when localStorage key contains invalid JSON', () => {
      localStorageMock.setItem('amana:trade-templates', 'not-json');
      const templates = loadTemplates();
      expect(templates).toEqual([]);
    });

    it('returns [] when localStorage key contains non-array JSON', () => {
      localStorageMock.setItem('amana:trade-templates', JSON.stringify({ foo: 'bar' }));
      const templates = loadTemplates();
      expect(templates).toEqual([]);
    });
  });

  describe('saveTemplate', () => {
    it('stores a template and loadTemplates returns it', () => {
      saveTemplate('My Maize Trade', sampleData);
      const templates = loadTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('My Maize Trade');
      expect(templates[0].data).toEqual(sampleData);
    });

    it('assigns a unique id to each template', () => {
      const t1 = saveTemplate('Template A', sampleData);
      const t2 = saveTemplate('Template B', sampleData);
      expect(t1.id).toBeTruthy();
      expect(t2.id).toBeTruthy();
      expect(t1.id).not.toBe(t2.id);
    });

    it('assigns a savedAt ISO string', () => {
      const before = new Date().toISOString();
      const template = saveTemplate('My Trade', sampleData);
      const after = new Date().toISOString();
      expect(template.savedAt).toBeTruthy();
      expect(template.savedAt >= before).toBe(true);
      expect(template.savedAt <= after).toBe(true);
    });

    it('accumulates multiple templates', () => {
      saveTemplate('First', { commodity: 'Rice' });
      saveTemplate('Second', { commodity: 'Maize' });
      const templates = loadTemplates();
      expect(templates).toHaveLength(2);
    });

    it('trims whitespace from template name', () => {
      const template = saveTemplate('  Padded Name  ', sampleData);
      expect(template.name).toBe('Padded Name');
    });
  });

  describe('deleteTemplate', () => {
    it('removes the template with the given id', () => {
      const t1 = saveTemplate('Keep Me', sampleData);
      const t2 = saveTemplate('Delete Me', sampleData);
      deleteTemplate(t2.id);
      const templates = loadTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe(t1.id);
    });

    it('is a no-op when the id does not exist', () => {
      saveTemplate('Existing', sampleData);
      deleteTemplate('non-existent-id');
      const templates = loadTemplates();
      expect(templates).toHaveLength(1);
    });

    it('results in empty array after deleting the only template', () => {
      const t = saveTemplate('Only One', sampleData);
      deleteTemplate(t.id);
      expect(loadTemplates()).toEqual([]);
    });
  });
});
