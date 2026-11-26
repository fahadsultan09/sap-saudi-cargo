let pendingFile = null;

export function setPendingFile(file) {
  pendingFile = file || null;
}

export function takePendingFile() {
  const file = pendingFile;
  pendingFile = null;
  return file;
}
