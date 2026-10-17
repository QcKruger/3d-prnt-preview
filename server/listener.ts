// IISNode passes a Windows named pipe in PORT instead of a TCP port number.
export function listenerTarget(value: string | undefined): number | string {
  if (value?.startsWith("\\\\.\\pipe\\") && !/[\r\n\0]/.test(value))
    return value;
  const port = Number(value || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid TCP port or an IISNode named pipe.");
  return port;
}
