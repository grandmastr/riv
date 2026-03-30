import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

test('built Riv extension sidepanel page renders', async () => {
  test.setTimeout(60_000);

  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('.riv-shell')).toBeVisible();
    await expect(page.locator('.riv-brand-mark')).toHaveText('Riv');
  } finally {
    await context.close();
  }
});

test('sidepanel composer stays pinned when transcript grows', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const layout = await page.evaluate(() => {
      const transcript = document.querySelector('.riv-transcript');
      const composer = document.querySelector('.riv-composer');

      if (!(transcript instanceof HTMLElement)) {
        throw new Error('Missing transcript container.');
      }

      if (!(composer instanceof HTMLElement)) {
        throw new Error('Missing composer container.');
      }

      for (let index = 0; index < 60; index += 1) {
        const message = document.createElement('article');
        message.className = 'riv-message riv-message-assistant';
        message.innerHTML =
          '<div class="riv-message-meta"><span class="riv-message-role">Riv</span><time>04:00 PM</time></div><div class="riv-message-surface"><div class="riv-message-body"><p class="riv-message-content">Streaming content block ' +
          index +
          ' keeps growing.</p></div></div>';
        transcript.appendChild(message);
      }

      const rect = composer.getBoundingClientRect();

      return {
        composerBottom: rect.bottom,
        viewportHeight: window.innerHeight,
        transcriptScrollHeight: transcript.scrollHeight,
        transcriptClientHeight: transcript.clientHeight
      };
    });

    expect(layout.composerBottom).toBeLessThanOrEqual(
      layout.viewportHeight + 1
    );
    expect(layout.transcriptScrollHeight).toBeGreaterThan(
      layout.transcriptClientHeight
    );
  } finally {
    await context.close();
  }
});

test('assistant messages use denser typography than the previous default', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const typography = await page.evaluate(() => {
      const transcript = document.querySelector('.riv-transcript');

      if (!(transcript instanceof HTMLElement)) {
        throw new Error('Missing transcript container.');
      }

      const message = document.createElement('article');
      message.className = 'riv-message riv-message-assistant';
      message.innerHTML =
        '<div class="riv-message-meta"><span class="riv-message-role">Riv</span><time>04:00 PM</time></div><div class="riv-message-surface"><div class="riv-message-body"><p class="riv-message-content">Dense answer content should fit more information in view.</p></div></div>';
      transcript.appendChild(message);

      const content = message.querySelector('.riv-message-content');

      if (!(content instanceof HTMLElement)) {
        throw new Error('Missing assistant message content.');
      }

      const styles = window.getComputedStyle(content);

      return {
        fontSize: Number.parseFloat(styles.fontSize),
        lineHeight: Number.parseFloat(styles.lineHeight)
      };
    });

    expect(typography.fontSize).toBeLessThan(16);
    expect(typography.lineHeight).toBeLessThan(26.56);
  } finally {
    await context.close();
  }
});

test('user messages render without bubble chrome', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const surfaceStyles = await page.evaluate(() => {
      const transcript = document.querySelector('.riv-transcript');

      if (!(transcript instanceof HTMLElement)) {
        throw new Error('Missing transcript container.');
      }

      const message = document.createElement('article');
      message.className = 'riv-message riv-message-user';
      message.innerHTML =
        '<div class="riv-message-meta"><span class="riv-message-role">You</span><time>04:00 PM</time></div><div class="riv-message-surface"><div class="riv-message-body"><p class="riv-message-content">This user bubble should feel a bit tighter vertically.</p></div></div>';
      transcript.appendChild(message);

      const surface = message.querySelector('.riv-message-surface');

      if (!(surface instanceof HTMLElement)) {
        throw new Error('Missing user message surface.');
      }

      const content = message.querySelector('.riv-message-content');

      if (!(content instanceof HTMLElement)) {
        throw new Error('Missing user message content.');
      }

      const styles = window.getComputedStyle(surface);
      const contentStyles = window.getComputedStyle(content);
      const transcriptRect = transcript.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();

      return {
        width: styles.width,
        paddingTop: Number.parseFloat(styles.paddingTop),
        paddingBottom: Number.parseFloat(styles.paddingBottom),
        paddingLeft: Number.parseFloat(styles.paddingLeft),
        paddingRight: Number.parseFloat(styles.paddingRight),
        borderTopWidth: Number.parseFloat(styles.borderTopWidth),
        backgroundColor: styles.backgroundColor,
        boxShadow: styles.boxShadow,
        rightInset: transcriptRect.right - surfaceRect.right,
        textAlign: contentStyles.textAlign
      };
    });

    expect(surfaceStyles.paddingTop).toBe(0);
    expect(surfaceStyles.paddingBottom).toBe(0);
    expect(surfaceStyles.paddingLeft).toBe(0);
    expect(surfaceStyles.paddingRight).toBe(0);
    expect(surfaceStyles.borderTopWidth).toBe(0);
    expect(surfaceStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(surfaceStyles.boxShadow).toBe('none');
    expect(surfaceStyles.width).not.toBe('100%');
    expect(surfaceStyles.rightInset).toBeLessThan(17);
    expect(surfaceStyles.textAlign).toBe('right');
  } finally {
    await context.close();
  }
});

test('composer send button stays square and unpadded', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const geometry = await page.evaluate(() => {
      const button = document.querySelector('.riv-composer-send');

      if (!(button instanceof HTMLElement)) {
        throw new Error('Missing composer send button.');
      }

      const styles = window.getComputedStyle(button);

      return {
        width: Number.parseFloat(styles.width),
        height: Number.parseFloat(styles.height),
        paddingTop: Number.parseFloat(styles.paddingTop),
        paddingRight: Number.parseFloat(styles.paddingRight),
        paddingBottom: Number.parseFloat(styles.paddingBottom),
        paddingLeft: Number.parseFloat(styles.paddingLeft),
        display: styles.display,
        alignItems: styles.alignItems,
        justifyContent: styles.justifyContent
      };
    });

    expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(1);
    expect(geometry.width).toBeGreaterThanOrEqual(35);
    expect(geometry.width).toBeLessThanOrEqual(37);
    expect(geometry.height).toBeGreaterThanOrEqual(35);
    expect(geometry.height).toBeLessThanOrEqual(37);
    expect(geometry.paddingTop).toBe(0);
    expect(geometry.paddingRight).toBe(0);
    expect(geometry.paddingBottom).toBe(0);
    expect(geometry.paddingLeft).toBe(0);
    expect(geometry.display).toContain('flex');
    expect(geometry.alignItems).toBe('center');
    expect(geometry.justifyContent).toBe('center');
  } finally {
    await context.close();
  }
});

test('composer footer stays transparent over the transcript', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const composerSurface = await page.evaluate(() => {
      const composer = document.querySelector('.riv-composer');

      if (!(composer instanceof HTMLElement)) {
        throw new Error('Missing composer footer.');
      }

      const styles = window.getComputedStyle(composer);

      return {
        backgroundColor: styles.backgroundColor,
        position: styles.position
      };
    });

    expect(composerSurface.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(composerSurface.position).toBe('absolute');
  } finally {
    await context.close();
  }
});

test('composer shell keeps its own visible surface', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const shellSurface = await page.evaluate(() => {
      const shell = document.querySelector('.riv-composer-shell');

      if (!(shell instanceof HTMLElement)) {
        throw new Error('Missing composer shell.');
      }

      const styles = window.getComputedStyle(shell);

      return {
        backgroundColor: styles.backgroundColor
      };
    });

    expect(shellSurface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  } finally {
    await context.close();
  }
});

test('composer field wrapper does not introduce an inner surface', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const fieldSurface = await page.evaluate(() => {
      const field = document.querySelector('.riv-composer-field');

      if (!(field instanceof HTMLElement)) {
        throw new Error('Missing composer field wrapper.');
      }

      const styles = window.getComputedStyle(field);

      return {
        backgroundColor: styles.backgroundColor,
        borderTopWidth: styles.borderTopWidth
      };
    });

    expect(fieldSurface.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(fieldSurface.borderTopWidth).toBe('0px');
  } finally {
    await context.close();
  }
});

test('composer textarea stays borderless inside the shell', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const textareaSurface = await page.evaluate(() => {
      const textarea = document.querySelector('.riv-composer textarea');

      if (!(textarea instanceof HTMLElement)) {
        throw new Error('Missing composer textarea.');
      }

      const styles = window.getComputedStyle(textarea);

      return {
        backgroundColor: styles.backgroundColor,
        borderTopWidth: styles.borderTopWidth
      };
    });

    expect(textareaSurface.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(textareaSurface.borderTopWidth).toBe('0px');
  } finally {
    await context.close();
  }
});

test('composer textarea gives the input more vertical room', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const textareaMetrics = await page.evaluate(() => {
      const textarea = document.querySelector('.riv-composer textarea');

      if (!(textarea instanceof HTMLElement)) {
        throw new Error('Missing composer textarea.');
      }

      const styles = window.getComputedStyle(textarea);

      return {
        minHeight: Number.parseFloat(styles.minHeight),
        paddingTop: Number.parseFloat(styles.paddingTop),
        paddingBottom: Number.parseFloat(styles.paddingBottom)
      };
    });

    expect(textareaMetrics.minHeight).toBeGreaterThan(70);
    expect(textareaMetrics.paddingTop).toBeGreaterThan(9);
    expect(textareaMetrics.paddingBottom).toBeGreaterThan(9);
  } finally {
    await context.close();
  }
});

test('composer textarea uses smaller type and tighter internal padding', async () => {
  const extensionPath = path.resolve(
    process.cwd(),
    'apps/extension/.output/chrome-mv3'
  );
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded'
    });

    const typography = await page.evaluate(() => {
      const textarea = document.querySelector('.riv-composer textarea');

      if (!(textarea instanceof HTMLElement)) {
        throw new Error('Missing composer textarea.');
      }

      const styles = window.getComputedStyle(textarea);
      const placeholderStyles = window.getComputedStyle(
        textarea,
        '::placeholder'
      );

      return {
        fontSize: Number.parseFloat(styles.fontSize),
        paddingTop: Number.parseFloat(styles.paddingTop),
        paddingRight: Number.parseFloat(styles.paddingRight),
        paddingBottom: Number.parseFloat(styles.paddingBottom),
        paddingLeft: Number.parseFloat(styles.paddingLeft),
        placeholderFontSize: Number.parseFloat(placeholderStyles.fontSize)
      };
    });

    expect(typography.fontSize).toBeLessThan(15);
    expect(typography.placeholderFontSize).toBeLessThan(15);
    expect(typography.paddingTop).toBeLessThan(11);
    expect(typography.paddingBottom).toBeLessThan(11);
    expect(typography.paddingLeft).toBeLessThan(7);
    expect(typography.paddingRight).toBeLessThan(44);
  } finally {
    await context.close();
  }
});
