import { describe, expect, it } from 'vitest';
import { initialsOf } from './Shell';

describe('initialsOf', () => {
  it('tên tiếng Việt lấy hai từ cuối', () => expect(initialsOf('Nguyễn Quốc Dũng')).toBe('QD'));
  it('một từ', () => expect(initialsOf('dung')).toBe('D'));
  it('rỗng', () => expect(initialsOf('  ')).toBe('?'));
});
