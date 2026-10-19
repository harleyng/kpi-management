import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImportActions } from './ImportActions';

describe('ImportActions', () => {
  it('"Nhập từ file" is disabled and described by its visible reason; the template waits for the data', () => {
    render(<ImportActions directory={undefined} />);
    const importButton = screen.getByRole('button', { name: 'Nhập từ file' });
    expect(importButton).toBeDisabled();
    expect(importButton).toHaveAccessibleDescription('Nhập từ file sẽ có khi khung nhập dữ liệu hoàn tất.');
    expect(screen.getByText('Nhập từ file sẽ có khi khung nhập dữ liệu hoàn tất.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tải mẫu nhập' })).toBeDisabled();
  });

  it('the template is offered once the org has loaded', () => {
    render(<ImportActions directory={{ units: [], positions: [], employees: [], assignments: [], accounts: [] }} />);
    expect(screen.getByRole('button', { name: 'Tải mẫu nhập' })).toBeEnabled();
  });
});
