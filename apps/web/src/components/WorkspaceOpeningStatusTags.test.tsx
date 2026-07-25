import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { WorkspaceOpeningStatusTags } from './WorkspaceOpeningStatusTags.js';

describe('WorkspaceOpeningStatusTags', () => {
  test('renders only opened workspace capabilities', () => {
    const codexOnly = renderToStaticMarkup(
      <WorkspaceOpeningStatusTags hasCodexSpace hasTeamSubscription={false} />
    );
    const teamOnly = renderToStaticMarkup(
      <WorkspaceOpeningStatusTags hasCodexSpace={false} hasTeamSubscription />
    );
    const unopened = renderToStaticMarkup(
      <WorkspaceOpeningStatusTags hasCodexSpace={false} hasTeamSubscription={false} />
    );

    expect(codexOnly).toContain('0.52');
    expect(codexOnly).not.toContain('双席位');
    expect(teamOnly).toContain('双席位');
    expect(teamOnly).not.toContain('0.52');
    expect(unopened).toBe('');
  });

  test('renders both tags when both capabilities are opened', () => {
    const html = renderToStaticMarkup(
      <WorkspaceOpeningStatusTags hasCodexSpace hasTeamSubscription />
    );

    expect(html).toContain('0.52');
    expect(html).toContain('双席位');
    expect(html).not.toContain('未开');
  });
});
