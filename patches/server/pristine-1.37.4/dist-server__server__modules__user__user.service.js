import { AppError } from '../../shared/utils.js';
/**
 * The longest a draft scope or preference key may be.
 *
 * Scopes are session UUIDs or `project:<id>`, and preference keys are fixed
 * identifiers, so anything longer is a client bug or an attempt to use the
 * table as general storage.
 */
const MAX_KEY_LENGTH = 200;
/** Guards against a runaway composer filling the database with one row. */
const MAX_DRAFT_TEXT_LENGTH = 100_000;
const readDraftScope = (value) => {
    const scope = typeof value === 'string' ? value.trim() : '';
    if (!scope || scope.length > MAX_KEY_LENGTH) {
        throw new AppError('A draft scope of 1-200 characters is required', {
            code: 'INVALID_DRAFT_SCOPE',
            statusCode: 400,
        });
    }
    return scope;
};
const readPreferenceUpdates = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new AppError('Preferences must be sent as an object', {
            code: 'INVALID_PREFERENCES',
            statusCode: 400,
        });
    }
    const updates = body;
    for (const key of Object.keys(updates)) {
        if (!key || key.length > MAX_KEY_LENGTH) {
            throw new AppError('Preference keys must be 1-200 characters', {
                code: 'INVALID_PREFERENCE_KEY',
                statusCode: 400,
            });
        }
    }
    return updates;
};
/** Creates user-profile workflows with explicit repository and Git adapters. */
export function createUserService(dependencies) {
    return {
        async getGitConfig(userId) {
            let gitConfig = dependencies.users.getGitConfig(userId);
            if (!gitConfig || (!gitConfig.git_name && !gitConfig.git_email)) {
                const systemConfig = await dependencies.readSystemGitConfig();
                if (systemConfig.git_name || systemConfig.git_email) {
                    dependencies.users.updateGitConfig(userId, systemConfig.git_name, systemConfig.git_email);
                    gitConfig = systemConfig;
                    dependencies.logInfo(`Auto-populated Git config for user ${userId}`);
                }
            }
            return {
                success: true,
                gitName: gitConfig?.git_name ?? null,
                gitEmail: gitConfig?.git_email ?? null,
            };
        },
        async updateGitConfig(userId, gitNameInput, gitEmailInput) {
            const gitName = typeof gitNameInput === 'string' ? gitNameInput.trim() : '';
            const gitEmail = typeof gitEmailInput === 'string' ? gitEmailInput.trim() : '';
            if (!gitName || !gitEmail) {
                throw new AppError('Git name and email are required', {
                    code: 'GIT_CONFIG_REQUIRED',
                    statusCode: 400,
                });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail)) {
                throw new AppError('Invalid email format', {
                    code: 'INVALID_GIT_EMAIL',
                    statusCode: 400,
                });
            }
            dependencies.users.updateGitConfig(userId, gitName, gitEmail);
            try {
                await dependencies.applyGlobalGitConfig(gitName, gitEmail);
            }
            catch (error) {
                // Persisted user settings remain authoritative even if the host Git
                // installation cannot be updated (matching the previous behavior).
                dependencies.logError('Failed to apply global Git config', error);
            }
            return { success: true, gitName, gitEmail };
        },
        completeOnboarding(userId) {
            dependencies.users.completeOnboarding(userId);
            return { success: true, message: 'Onboarding completed successfully' };
        },
        getOnboardingStatus(userId) {
            return {
                success: true,
                hasCompletedOnboarding: dependencies.users.hasCompletedOnboarding(userId),
            };
        },
        /** Every stored preference at once; the client fills gaps with its defaults. */
        getPreferences(userId) {
            return { success: true, preferences: dependencies.preferences.getPreferences(userId) };
        },
        /**
         * Merge-patch: only the keys in the request body are touched, so two
         * independent settings screens can save concurrently without one erasing
         * the other's work.
         */
        savePreferences(userId, body) {
            const updates = readPreferenceUpdates(body);
            dependencies.preferences.savePreferences(userId, updates);
            return { success: true, preferences: dependencies.preferences.getPreferences(userId) };
        },
        getDrafts(userId) {
            return { success: true, drafts: dependencies.drafts.getDrafts(userId) };
        },
        saveDraft(userId, scopeInput, body) {
            const scope = readDraftScope(scopeInput);
            const payload = (body ?? {});
            const text = typeof payload.text === 'string' ? payload.text : '';
            if (text.length > MAX_DRAFT_TEXT_LENGTH) {
                throw new AppError('Draft text is too long to store', {
                    code: 'DRAFT_TEXT_TOO_LONG',
                    statusCode: 413,
                });
            }
            dependencies.drafts.saveDraft(userId, scope, {
                text,
                queuedMessage: payload.queuedMessage ?? null,
            });
            return { success: true };
        },
        deleteDraft(userId, scopeInput) {
            dependencies.drafts.deleteDraft(userId, readDraftScope(scopeInput));
            return { success: true };
        },
    };
}
//# sourceMappingURL=user.service.js.map