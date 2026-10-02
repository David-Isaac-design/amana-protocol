import type { TradeData } from '@/app/trades/create/TradeContext';

export interface TradeTemplate {
  id: string;
  name: string;
  savedAt: string;
  data: Partial<TradeData>;
}

const TEMPLATES_KEY = 'amana:trade-templates';

export function loadTemplates(): TradeTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TradeTemplate[]) : [];
  } catch {
    return [];
  }
}

export function saveTemplate(name: string, data: Partial<TradeData>): TradeTemplate {
  const template: TradeTemplate = {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    savedAt: new Date().toISOString(),
    data,
  };
  const existing = loadTemplates();
  existing.push(template);
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(existing));
  } catch {
    // Silently ignore quota errors
  }
  return template;
}

export function deleteTemplate(id: string): void {
  const existing = loadTemplates();
  const updated = existing.filter((t) => t.id !== id);
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  } catch {
    // Silently ignore quota errors
  }
}
