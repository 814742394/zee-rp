// Implementation and native evidence are separate. Historical labels are not new native proof.
export const RP9_COMMAND_STATUS = {
  'rp-read': 'core',
  'set-widget-text': 'core',
  'clone-library-widget': 'core',
  'create-blank-project': 'core',
  'create-blank-page': 'core',
  'axvg build': 'core',
  'axvg selftest': 'core',
  'duplicate-page': 'unverified',
  'create-global-variable': 'unverified',
  'create-master': 'unverified',
  'place-master': 'unverified',
  'create-panel-clone': 'unverified',
  'fill-panel-state': 'unverified',
  'remove-panel-state-content': 'unverified',
  'set-panel-fit-to-content': 'unverified',
  'add-adaptive-view': 'unverified',
  'add-interaction': 'unverified',
  'remove-interaction': 'unverified',
  'add-click-link': 'unverified',
  'clone-library-page-content': 'unverified',
  'set-combobox-options': 'unverified',
  'set-listbox-options': 'unverified',
  'set-native-table': 'unverified',
  'clone-native-connector': 'unverified',
  'set-connector-anchors': 'unverified',
  'set-widget-richtext': 'unverified',
  'set-master-overrides': 'unverified',
  'name-widget': 'unverified',
  'patch-link-window': 'unverified',
  'patch-string': 'unverified',
  // 剪贴板落画：本机实测 RP9 画布不识别该内容（2026-10-20），默认拒绝。
  // 上游 0.2.1 改成「按 --version 9 正常放行」，两者结论冲突，见 docs/rp9-capabilities.md。
  // 需要试这条路线时用 AXURE_ALLOW_RP9_PASTE=1 显式放行，此时只给 unverified 提示。
  'axvg paste': 'blocked',
};
export const generationCapabilities = Object.freeze(Object.fromEntries([9, 11].map(version => [version, {
  basic: { support: 'native', implementation: 'implemented', evidence: { structure: false, nativeOpen: false, preview: false, saveReopen: false } },
  advanced: { support: version === 9 ? 'native' : 'unsupported', implementation: version === 9 ? 'implemented' : 'missing', evidence: { structure: false, nativeOpen: false, preview: false, saveReopen: false } },
}])));
export function commandCapability(version, command) {
  let status = version === 9 ? RP9_COMMAND_STATUS[command] ?? 'unverified' : 'unverified';
  if (version === 9 && command === 'axvg paste' && process.env.AXURE_ALLOW_RP9_PASTE === '1') status = 'unverified';
  return { status, support: status === 'blocked' ? 'unsupported' : 'native', implementation: 'implemented',
    evidence: { structure: false, nativeOpen: false, preview: false, saveReopen: false },
    historicalSource: version === 9 && status === 'core' ? 'docs/rp9-capabilities.md' : null };
}
