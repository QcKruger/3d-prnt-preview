# Run explicitly against existing resources after deploying the Node app.
# This does not create a database/container or upload application code.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][guid]$SubscriptionId,
    [Parameter(Mandatory)][string]$AppResourceGroup,
    [Parameter(Mandatory)][string]$AppName,
    [Parameter(Mandatory)][string]$CosmosResourceGroup,
    [Parameter(Mandatory)][string]$CosmosAccount,
    [Parameter(Mandatory)][string]$Database,
    [Parameter(Mandatory)][string]$Container,
    [ValidateSet('Reader', 'Contributor')][string]$DataRole = 'Reader',
    [switch]$DisableKeyAuthentication
)
$ErrorActionPreference = 'Stop'
foreach ($identifier in @($AppResourceGroup, $AppName, $CosmosResourceGroup, $CosmosAccount, $Database, $Container)) {
    if ([string]::IsNullOrWhiteSpace($identifier) -or $identifier -match '[/\\?#\x00-\x1f\x7f]' -or $identifier.StartsWith('-')) {
        throw 'Supply valid Azure resource, database and container names.'
    }
}
function Invoke-Azure {
    param([string[]]$Arguments)
    $result = & az @Arguments --subscription $SubscriptionId --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw 'Azure CLI operation failed. Check the selected resources and your permissions.' }
    return $result
}

# Check resources before changing identity, roles or settings.
$endpoint = Invoke-Azure -Arguments @('cosmosdb', 'show', '-g', $CosmosResourceGroup, '-n', $CosmosAccount, '--query', 'documentEndpoint', '-o', 'tsv')
$hostname = Invoke-Azure -Arguments @('webapp', 'show', '-g', $AppResourceGroup, '-n', $AppName, '--query', 'defaultHostName', '-o', 'tsv')
$null = Invoke-Azure -Arguments @('cosmosdb', 'sql', 'container', 'show', '-g', $CosmosResourceGroup, '-a', $CosmosAccount, '-d', $Database, '-n', $Container, '-o', 'none')
$principal = Invoke-Azure -Arguments @('webapp', 'identity', 'assign', '-g', $AppResourceGroup, '-n', $AppName, '--query', 'principalId', '-o', 'tsv')
if (!$principal -or !$endpoint -or !$hostname) { throw 'Azure did not return the required identity or endpoint metadata.' }

$scope = "/dbs/$Database/colls/$Container"
$roleId = if ($DataRole -eq 'Reader') { '00000000-0000-0000-0000-000000000001' } else { '00000000-0000-0000-0000-000000000002' }
# Stable assignment ID makes repeat runs update the same assignment.
$hash = [System.Security.Cryptography.SHA256]::Create()
try {
    $bytes = $hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$principal|$scope|$roleId"))
    $assignmentId = [guid]::new([byte[]]$bytes[0..15]).ToString()
} finally { $hash.Dispose() }
$null = Invoke-Azure -Arguments @('cosmosdb', 'sql', 'role', 'assignment', 'create', '-g', $CosmosResourceGroup, '-a', $CosmosAccount, '--role-assignment-id', $assignmentId, '--principal-id', $principal, '--role-definition-id', $roleId, '--scope', $scope, '-o', 'none')

if ($DisableKeyAuthentication) {
    # Account-wide change: opt in only after migrating other clients off keys.
    $null = Invoke-Azure -Arguments @('resource', 'update', '-g', $CosmosResourceGroup, '-n', $CosmosAccount, '--resource-type', 'Microsoft.DocumentDB/databaseAccounts', '--set', 'properties.disableLocalAuth=true', '-o', 'none')
}
$null = Invoke-Azure -Arguments @('webapp', 'update', '-g', $AppResourceGroup, '-n', $AppName, '--https-only', 'true', '-o', 'none')
$null = Invoke-Azure -Arguments @('webapp', 'config', 'appsettings', 'set', '-g', $AppResourceGroup, '-n', $AppName, '--settings', "COSMOS_ENDPOINT=$endpoint", "COSMOS_DATABASE=$Database", "COSMOS_CONTAINER=$Container", 'COSMOS_AUTH_MODE=managed-identity', 'NODE_ENV=production', 'HOST=0.0.0.0', "APP_ORIGIN=https://$hostname", '-o', 'none')
Write-Host "Configured system-assigned identity and Cosmos $DataRole access at $scope. Allow role propagation before restarting/testing."
