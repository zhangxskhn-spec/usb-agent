/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 */
const PROVIDER_CAPABILITIES = {
    claude: {
        provider: 'claude',
        permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
        defaultPermissionMode: 'default',
        supportsImages: true,
        supportsFiles: true,
        supportsAbort: true,
        supportsPermissionRequests: true,
        supportsTokenUsage: true,
        supportsEffort: true,
        effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
        // `resumeSessionAt` re-runs a conversation truncated at a message, and
        // `forkSession` copies a transcript prefix into a new session file.
        supportsMessageEditing: true,
        supportsSessionForking: true,
    },
    cursor: {
        provider: 'cursor',
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
        defaultPermissionMode: 'default',
        supportsImages: true,
        supportsFiles: true,
        supportsAbort: true,
        supportsPermissionRequests: false,
        supportsTokenUsage: false,
        supportsEffort: false,
        effortLevels: [],
        supportsMessageEditing: false,
        supportsSessionForking: false,
    },
    codex: {
        provider: 'codex',
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions'],
        defaultPermissionMode: 'default',
        supportsImages: true,
        supportsFiles: true,
        supportsAbort: true,
        supportsPermissionRequests: false,
        supportsTokenUsage: true,
        supportsEffort: true,
        effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        // Not from the Codex SDK, which only starts and resumes threads: both ride
        // the same CLI's `app-server` protocol, whose `thread/fork` copies a
        // thread up to a chosen turn. Editing is that fork plus a new prompt,
        // which is how Codex's own IDE clients do it.
        supportsMessageEditing: true,
        supportsSessionForking: true,
    },
    opencode: {
        provider: 'opencode',
        // Mapped by the runtime onto OpenCode's controls: `--agent plan` (plan),
        // `--auto` (bypassPermissions) and the OPENCODE_PERMISSION env var
        // (acceptEdits). See resolveOpenCodePermissionOptions in the OpenCode runtime adapter.
        permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
        defaultPermissionMode: 'default',
        supportsImages: true,
        supportsFiles: true,
        supportsAbort: true,
        supportsPermissionRequests: false,
        supportsTokenUsage: true,
        supportsEffort: true,
        // Passed on as OpenCode's `--variant`. `thinking` (MiniMax's on/off
        // variant, paired with `none`) is not a strength, so it sorts last.
        effortLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'],
        supportsMessageEditing: false,
        supportsSessionForking: false,
    },
};
/**
 * Application service exposing the provider capability matrix. Used by the
 * Providers routes (the capabilities endpoints) and by the Providers model
 * service, which reads `effortLevels` to validate custom-model effort.
 */
export const providerCapabilitiesService = {
    getProviderCapabilities(provider) {
        return PROVIDER_CAPABILITIES[provider];
    },
    listAllProviderCapabilities() {
        return Object.values(PROVIDER_CAPABILITIES);
    },
};
//# sourceMappingURL=provider-capabilities.service.js.map