$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

# Read only explicitly listed public project files. Never load local secrets.
function Get-PublicProjectPath([string] $relativePath) {
    $current = $projectRoot
    foreach ($part in ($relativePath -split '/')) {
        $current = Join-Path $current $part
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Links are not allowed in harness paths: $relativePath"
        }
    }
    return $current
}

function Assert-Condition([bool] $condition, [string] $message) {
    if (-not $condition) { throw $message }
}

$hasLocalDocs = Test-Path -LiteralPath (Join-Path $projectRoot 'docs')
$hasLocalRules = Test-Path -LiteralPath (Join-Path $projectRoot 'AGENTS.md')
$requiredDirectories = @('src/extension', 'config', 'tools')
if ($hasLocalDocs -or $hasLocalRules) {
    Assert-Condition ($hasLocalDocs -and $hasLocalRules) 'Local documentation and AGENTS.md must be kept together.'
    $requiredDirectories += @('docs/planning', 'docs/implementation-plans', 'docs/troubleshooting', 'docs/architecture')
}
foreach ($relativePath in $requiredDirectories) {
    $path = Get-PublicProjectPath $relativePath
    Assert-Condition (Test-Path -LiteralPath $path -PathType Container) "Missing directory: $relativePath"
}

$requiredFiles = @('README.md', '.gitignore', 'config/security-policy.json', 'guide/installation.md')
if ($hasLocalDocs -or $hasLocalRules) {
    $requiredFiles += @('AGENTS.md', 'docs/planning/product-scope.md',
        'docs/implementation-plans/0001-project-harness.md', 'docs/architecture/repository-layout.md',
        'docs/architecture/security.md', 'docs/troubleshooting/README.md')
}
foreach ($relativePath in $requiredFiles) {
    $path = Get-PublicProjectPath $relativePath
    Assert-Condition (Test-Path -LiteralPath $path -PathType Leaf) "Missing file: $relativePath"
}

$policy = Get-Content -LiteralPath (Get-PublicProjectPath 'config/security-policy.json') -Raw | ConvertFrom-Json
Assert-Condition ($policy.schemaVersion -eq 18) 'Unsupported security policy version.'
Assert-Condition ($policy.formatRetries.maxRetries -eq 3 -and $policy.formatRetries.delayMs -eq 5000 -and $policy.formatRetries.logRawContent -eq $false) 'Format retries and safe logs must be bounded.'
Assert-Condition ($policy.videoTranslation.persistentTranslationCache.maxVideos -eq 30 -and $policy.videoTranslation.persistentTranslationCache.maxBytes -eq 4194304 -and $policy.videoTranslation.persistentTranslationCache.accessLevel -eq 'TRUSTED_CONTEXTS' -and $policy.videoTranslation.persistentTranslationCache.storeKeys -eq $false) 'Persistent video cache must be bounded and trusted.'
Assert-Condition ($policy.translationScheduling.maxConcurrentRequests -eq 5 -and $policy.translationScheduling.maxAttemptsPerMinute -eq 60 -and $policy.translationScheduling.windowMs -eq 60000 -and $policy.translationScheduling.restAfterWaveMs -eq 5000) 'Translation scheduling must be bounded and paced.'
Assert-Condition ($policy.providers.openai.maxConcurrentWorkers -eq 5) 'OpenAI worker concurrency must match translation scheduling.'
Assert-Condition ($policy.providers.openai.apiOrigin -eq 'https://api.openai.com' -and $policy.providers.openai.translationPath -eq '/v1/responses' -and $policy.providers.openai.catalogPath -eq '/v1/models') 'OpenAI endpoints must be fixed.'
Assert-Condition ($policy.providers.openai.storeResponses -eq $false -and $policy.providers.openai.automaticRetries -eq 0) 'OpenAI adapter must not repeat ambiguous requests; format retries are managed by the content task.'
Assert-Condition ($policy.secrets.openaiKeyTransit -eq 'verified-offscreen-private-port-and-dedicated-worker-memory-only' -and $policy.providers.openai.portVerification -eq $policy.providers.kie.portVerification) 'OpenAI key transit must verify the live offscreen document.'
Assert-Condition ($policy.providers.openai.requestTimeoutMs -eq 180000 -and $policy.providers.openai.uiTimeoutMs -eq 200000 -and $policy.providers.openai.closeOffscreenWhenIdle -eq $true) 'OpenAI requests must be bounded and cleaned up.'
Assert-Condition ($policy.providers.kie.status -eq 'legacy-disabled' -and $policy.providers.kie.allowSelection -eq $false -and $policy.providers.kie.allowRequests -eq $false) 'Legacy Kie selection and requests must stay disabled.'
Assert-Condition ($policy.providers.kie.publicPricing.url -eq 'https://api.kie.ai/client/v1/model-pricing/page' -and $policy.providers.kie.publicPricing.credentials -eq $false -and $policy.providers.kie.publicPricing.minimumIntervalSeconds -eq 30) 'Pricing must be fixed, public and rate limited.'
Assert-Condition ($policy.providers.kie.apiOrigin -eq 'https://api.kie.ai' -and $policy.providers.kie.catalogOrigin -eq 'https://docs.kie.ai') 'Kie origins must be fixed.'
Assert-Condition ($policy.providers.kie.catalogCredentials -eq $false -and $policy.providers.kie.images -eq $false) 'No keys in public catalog or unverified image upload.'
Assert-Condition ($policy.tokenUsage.accessLevel -eq 'TRUSTED_CONTEXTS') 'Usage must stay in trusted contexts.'
Assert-Condition ($policy.tokenUsage.storage -eq 'chrome.storage.local') 'Usage must persist locally.'
Assert-Condition ($policy.tokenUsage.retainContent -eq $false -and $policy.tokenUsage.retainKeys -eq $false -and $policy.tokenUsage.retainUrls -eq $false) 'Usage must not retain content, keys or URLs.'
Assert-Condition ($policy.tokenUsage.retentionDays -eq 365 -and $policy.tokenUsage.maxAggregateRows -eq 10000 -and $policy.tokenUsage.maxPendingIds -eq 128) 'Usage retention must be bounded.'
Assert-Condition ($policy.tokenUsage.clearPages.Count -eq 1 -and $policy.tokenUsage.clearPages[0] -eq 'statistics.html') 'Only statistics may clear usage.'
Assert-Condition ($policy.enforcement -eq 'policy-only') 'Document the actual enforcement level.'
Assert-Condition ($policy.secrets.source -eq 'user-settings-ui') 'Keys must come from user settings.'
Assert-Condition ($policy.secrets.providerKeyRuntime -eq 'extension-background') 'Unexpected key runtime.'
Assert-Condition ($policy.secrets.kieKeyTransit -eq 'verified-offscreen-private-port-and-dedicated-worker-memory-only') 'Kie key transit must use verified private contexts.'
Assert-Condition ($policy.providers.kie.requestTimeoutMs -eq 180000) 'Kie requests must be bounded to three minutes.'
Assert-Condition ($policy.providers.kie.maxConcurrentWorkers -eq 2) 'Kie worker concurrency must be bounded.'
Assert-Condition ($policy.providers.kie.portVerification -eq 'extension-id-origin-tabless-creation-nonce-live-offscreen-context-optional-sender-document-id') 'Kie port verification must bind the creation nonce to a live offscreen document.'
Assert-Condition ($policy.providers.kie.closeOffscreenWhenIdle -eq $true) 'Idle offscreen work must be closed.'
Assert-Condition ($policy.secrets.storage -eq 'chrome.storage.local') 'Saved keys must use local storage.'
Assert-Condition ($policy.secrets.scope -eq 'provider-and-exact-model-id') 'Keys must be isolated per provider/model.'
Assert-Condition ($policy.secrets.temporaryCatalogStorage -eq 'chrome.storage.session') 'Temporary catalogs must use session storage.'
Assert-Condition ($policy.secrets.allowSync -eq $false) 'Keys must not sync.'
Assert-Condition ($policy.secrets.allowExport -eq $false) 'Key export is forbidden.'
Assert-Condition ($policy.secrets.allowKeyRedisplay -eq $false) 'Stored keys must not be redisplayed.'
Assert-Condition ($policy.secrets.encryptionAtRest -eq 'not-provided-by-extension') 'Do not claim encryption that is not implemented.'
Assert-Condition ($policy.secrets.deletion -contains 'per-model') 'Per-model deletion is required.'
Assert-Condition ($policy.secrets.deletion -contains 'all-models') 'All-model deletion is required.'
Assert-Condition ($policy.secrets.accessLevel -eq 'TRUSTED_CONTEXTS') 'Keys must stay in trusted contexts.'
Assert-Condition ($policy.secrets.allowBundledProviderKeys -eq $false) 'Bundled provider keys are forbidden.'
Assert-Condition ($policy.secrets.allowKeysInContentScripts -eq $false) 'Content scripts must not receive keys.'
Assert-Condition ($policy.secrets.allowPersistentKeyStorage -eq $true) 'User requested persistent model keys.'
Assert-Condition ($policy.architecture.localServerRequired -eq $false) 'The product must work without a local server.'
Assert-Condition ($policy.secrets.allowSecretValuesInLogs -eq $false) 'Secret logging is forbidden.'
Assert-Condition ($policy.dataTransfer.requireUserConsent -eq $true) 'User consent is required.'
Assert-Condition ($policy.dataTransfer.consentFrequency -eq 'once-per-extension-version') 'Consent must be per extension version.'
Assert-Condition ($policy.dataTransfer.consentStorage -eq 'chrome.storage.local') 'Consent must persist locally.'
Assert-Condition ($policy.dataTransfer.consentAccessLevel -eq 'TRUSTED_CONTEXTS') 'Consent must stay in trusted contexts.'
Assert-Condition ($policy.models.bindCatalogToApiKey -eq $true) 'The model catalog must match the API key.'
Assert-Condition ($policy.models.selection -eq 'provider-catalog-and-audited-support') 'Models must come from the provider catalog.'
Assert-Condition ($policy.models.sort -eq 'verified-release-date-descending') 'Models must sort by verified release date.'
Assert-Condition ($policy.models.unknownReleaseDate -eq 'last') 'Unknown dates must sort last.'
Assert-Condition ($policy.dataTransfer.minimumNecessaryDataOnly -eq $true) 'Minimize transferred data.'
Assert-Condition ($policy.dataTransfer.retainPageContentByDefault -eq $false) 'Page retention must be off by default.'
Assert-Condition ($policy.dataTransfer.userRequestedTranslationCache.storage -eq 'chrome.storage.session') 'Requested translation cache must be session-only.'
Assert-Condition ($policy.dataTransfer.userRequestedTranslationCache.accessLevel -eq 'TRUSTED_CONTEXTS') 'Cache must stay in trusted contexts.'
Assert-Condition ($policy.dataTransfer.userRequestedTranslationCache.deleteOnTabClose -eq $true) 'Tab close must remove cached page content.'
Assert-Condition ($policy.dataTransfer.requireHttpsForRemoteEndpoints -eq $true) 'Remote endpoints must use HTTPS.'
Assert-Condition ($policy.imageTranslation.transmitFullScreenshot -eq $false) 'Only a cropped image may be transmitted.'
Assert-Condition ($policy.imageTranslation.transmitSourceUrl -eq $false) 'Image source URL must stay on device.'
Assert-Condition ($policy.imageTranslation.persistPixels -eq $false) 'Image pixels must remain transient.'
Assert-Condition ($policy.videoTranslation.transmitAudio -eq $false) 'Audio must not be sent to the model.'
Assert-Condition ($policy.videoTranslation.transmitVideo -eq $false) 'Video must not be sent to the model.'
Assert-Condition ($policy.videoTranslation.transmitVideoUrl -eq $false) 'Video URLs must stay on device.'
Assert-Condition ($policy.videoTranslation.transmitTimestamps -eq $false) 'Caption timing must stay on device.'
Assert-Condition ($policy.videoTranslation.persistCaptions -eq $false -and $policy.videoTranslation.persistentTranslationCache.storeRawSource -eq $false) 'Raw captions must remain transient; only translations and hashes are stored.'
Assert-Condition ($policy.videoTranslation.observeRequestHeaders -eq $false) 'Native caption observation must not collect headers.'
Assert-Condition ($policy.videoTranslation.generateYoutubeTokens -eq $false) 'Do not generate or bypass YouTube authorization tokens.'
Assert-Condition ($policy.videoTranslation.observationTimeoutMs -eq 12000) 'Native response observation must be bounded.'
Assert-Condition ($policy.videoTranslation.captionFetchOrigin -eq 'https://www.youtube.com') 'Caption collection must use the current YouTube origin.'
Assert-Condition ($policy.videoTranslation.inlineLauncher.origin -eq 'https://www.youtube.com') 'Inline entry is YouTube-only.'
Assert-Condition ($policy.videoTranslation.inlineLauncher.mainFrameOnly -eq $true) 'Inline entry must be top-frame only.'
Assert-Condition ($policy.videoTranslation.inlineLauncher.collectCaptionsOnDetection -eq $false) 'Detection must not collect captions.'
Assert-Condition ($policy.videoTranslation.inlineLauncher.translateOnOpen -eq $false) 'Opening must not start translation.'
Assert-Condition ($policy.videoTranslation.continuous.enabledByDefault -eq $false) 'Continuous translation requires explicit ON.'
Assert-Condition ($policy.videoTranslation.continuous.persistEnabled -eq $false) 'Do not persist translation ON.'
Assert-Condition ($policy.videoTranslation.continuous.minimumReadIntervalMs -eq 10000) 'Caption polling must be bounded.'
Assert-Condition ($policy.videoTranslation.continuous.minimumTranslationIntervalMs -eq 5000) 'Caption translation must be paced.'
Assert-Condition ($policy.videoTranslation.appearance.storage -eq 'chrome.storage.local') 'Appearance must persist locally.'
Assert-Condition ($policy.videoTranslation.appearance.accessLevel -eq 'TRUSTED_CONTEXTS') 'Appearance access must use the trusted broker.'
Assert-Condition ($policy.videoTranslation.appearance.allowRemoteFonts -eq $false) 'Do not load external fonts.'
Assert-Condition ($policy.videoTranslation.appearance.allowArbitraryCss -eq $false) 'Appearance must use validated values.'

$ignoreRules = Get-Content -LiteralPath (Get-PublicProjectPath '.gitignore')
foreach ($rule in @('AGENTS.md', '/docs/', '.env', '.env.*', '.secrets/', '*.pem', '*.key', '*.p12', '*.pfx', '*.log', 'credentials.*', 'api-key*.json', 'api_key*.json', 'auth.json', 'tools/.tmp/')) {
    Assert-Condition ($ignoreRules -ccontains $rule) "Missing ignore rule: $rule"
}

Assert-Condition (-not ($ignoreRules -ccontains '!.env.example')) 'Environment files must not have a public exception.'

Write-Output 'PASS: Project structure, extension-only security policy, and legacy secret ignore rules.'
Write-Output 'Scope: Configuration checks only; no secret files were read. Use npm test for runtime security tests.'
