import { expect } from '@jest/globals';
import { installSnap } from '@metamask/snaps-jest';
import { Box, Text } from '@metamask/snaps-sdk/jsx';

import { HOME_PAGE_HINT, renderSignInHint } from './insights';

const FROM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const TO = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

describe('onTransaction', () => {
  it('asks the user to sign in when the Snap has no credentials', async () => {
    const snap = await installSnap();

    const response = await snap.onTransaction({
      from: FROM,
      to: TO,
      value: '0x0',
      data: '0x',
    });

    expect(response.getInterface()).toRender(renderSignInHint());
    expect(JSON.stringify(response.getInterface().content)).toContain(
      HOME_PAGE_HINT,
    );
  });

  it('decodes ERC-20 calldata before deciding there is nothing to show', async () => {
    const snap = await installSnap();
    const recipient = TO.slice(2).toLowerCase().padStart(64, '0');
    const amount = '1'.padStart(64, '0');

    const response = await snap.onTransaction({
      from: FROM,
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: '0x0',
      data: `0xa9059cbb${recipient}${amount}`,
    });

    // Still signed out, so the hint is the same — but the handler ran end to
    // end through the decoder without throwing.
    expect(response.getInterface()).toRender(renderSignInHint());
  });
});

describe('renderSignInHint', () => {
  it('points at the home page', () => {
    expect(JSON.stringify(renderSignInHint())).toContain(HOME_PAGE_HINT);
    expect(renderSignInHint()).toStrictEqual(
      <Box>
        <Text>
          Sign in once to see the recipient's OFAC sanctions status and Cred
          score here.
        </Text>
        <Text size="sm" color="muted">
          {HOME_PAGE_HINT} and choose "Sign in with this wallet".
        </Text>
      </Box>,
    );
  });
});

describe('onHomePage', () => {
  it('offers to connect an account when none is exposed to the Snap', async () => {
    const snap = await installSnap();
    snap.mockJsonRpc({ method: 'eth_accounts', result: [] });

    const response = await snap.onHomePage();
    const content = JSON.stringify(response.getInterface().content);

    expect(content).toContain('Connect an account');
    expect(content).toContain('"name":"connect"');
  });

  it('shows the connected account and a sign-in button', async () => {
    const snap = await installSnap();
    snap.mockJsonRpc({ method: 'eth_accounts', result: [FROM] });

    const response = await snap.onHomePage();
    const content = JSON.stringify(response.getInterface().content);

    expect(content).toContain(FROM);
    expect(content).toContain('"name":"sign-in"');
    expect(content).toContain('Sign in to load');
  });

  it('asks for a wallet sign-in before showing the file when only an API key is held', async () => {
    // A fresh snapshot and no wallet token: the page makes no network call.
    const snap = await installSnap({
      options: {
        state: {
          apiKey: 'console-key',
          sessions: {},
          cache: {},
          home: {
            address: FROM.toLowerCase(),
            fetchedAt: Date.now(),
            score: { address: FROM.toLowerCase(), score: 712, range: 'good' },
          },
        },
      },
    });
    snap.mockJsonRpc({ method: 'eth_accounts', result: [FROM] });

    const response = await snap.onHomePage();
    const content = JSON.stringify(response.getInterface().content);

    expect(content).toContain('712');
    expect(content).toContain('Who looked you up');
    expect(content).toContain('"name":"file-sign-in"');
    expect(content).toContain('https://score.credprotocol.com/file');
    expect(content).not.toContain('inquiries-more');
  });
});
