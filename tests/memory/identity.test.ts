
import { orgLabel as _orgLabel, pickOrgName as _pickOrgName } from '../../src/main/memory/identity';
import { it as _it, expect as _expect } from 'vitest';
_it('empresa vinda do domínio ganha inicial maiúscula; a grafia citada pela IA vale mais', () => {
  _expect(_orgLabel('acme')).toBe('Acme');
  _expect(_orgLabel('acme-corp')).toBe('Acme-Corp');
  _expect(_orgLabel('iFood')).toBe('iFood');
  _expect(_pickOrgName(['acme', 'Acme Corp'])).toBe('Acme Corp');
  _expect(_pickOrgName(['acme', 'acme'])).toBe('Acme');
});
