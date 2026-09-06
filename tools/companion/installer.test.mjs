import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildLocalCompanionInstaller } from '../../lib/server/localCompanionInstaller.ts';

test('Windows package extracts and installs into isolated files and registry keys', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'joblit-installer-test-'));
  const installed = join(root, `smoke-${root.split(/[\\/]/).at(-1)}`);
  const archivePath = join(root, 'Joblit-Windows-Setup.zip');
  const registryKey = `HKCU:\\Software\\Joblit\\InstallerTests\\${installed.split(/[\\/]/).at(-1)}`;
  const powershell = (script) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true, encoding: 'utf8', timeout: 50000,
    env: { ...process.env, JOBLIT_TEST_ROOT: root, JOBLIT_TEST_INSTALL: installed, JOBLIT_TEST_NODE: process.execPath, JOBLIT_TEST_REGISTRY: registryKey },
  });
  try {
    await writeFile(archivePath, await buildLocalCompanionInstaller());
    const result = powershell(`
      $ErrorActionPreference = 'Stop'
      Expand-Archive -LiteralPath (Join-Path $env:JOBLIT_TEST_ROOT 'Joblit-Windows-Setup.zip') -DestinationPath (Join-Path $env:JOBLIT_TEST_ROOT 'package')
      & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $env:JOBLIT_TEST_ROOT 'package\\Install.ps1') -SmokeTest -InstallRoot $env:JOBLIT_TEST_INSTALL -NodeExecutable $env:JOBLIT_TEST_NODE
      if ($LASTEXITCODE -ne 0) { throw 'Isolated installation failed.' }
      $command = (Get-Item -LiteralPath (Join-Path $env:JOBLIT_TEST_REGISTRY 'joblit\\shell\\open\\command')).GetValue('')
      if (-not $command.Contains($env:JOBLIT_TEST_INSTALL) -or -not $command.Contains('-Uri "%1"')) { throw 'Invalid protocol registration.' }
      & (Join-Path $env:JOBLIT_TEST_INSTALL 'node.exe') --check (Join-Path $env:JOBLIT_TEST_INSTALL 'app\\app.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Installed runtime did not parse.' }
      $expectedRejection = $false
      try { & (Join-Path $env:JOBLIT_TEST_INSTALL 'Launch.ps1') -Uri 'joblit://connect?";bad-command' } catch { $expectedRejection = $true }
      if (-not $expectedRejection) { throw 'Launcher accepted an unsafe activation string.' }
    `);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const metadata = JSON.parse((await readFile(join(installed, 'installation.json'), 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(metadata.nodeVersion, '24.15.0');
    assert.deepEqual(await readFile(join(installed, 'app', 'runtime.mjs')), await readFile(resolve('tools/companion/runtime.mjs')));
  } finally {
    const cleanup = powershell(`
      $ErrorActionPreference = 'Stop'
      if ($env:JOBLIT_TEST_REGISTRY -notlike 'HKCU:\\Software\\Joblit\\InstallerTests\\smoke-joblit-installer-test-*') { throw 'Unsafe test registry cleanup.' }
      if (Test-Path -LiteralPath $env:JOBLIT_TEST_REGISTRY) { Remove-Item -LiteralPath $env:JOBLIT_TEST_REGISTRY -Recurse -Force }
    `);
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
    await rm(root, { recursive: true, force: true });
  }
});
