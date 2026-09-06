import { HttpStatus } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { isIgnoredPath, isSourceFile } from '../indexing.constants.js';

function isSafeEntryName(entryName: string): boolean {
  if (!entryName || entryName.trim().length === 0) {
    return false;
  }
  if (entryName.startsWith('/') || entryName.startsWith('\\')) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(entryName)) {
    return false;
  }
  return !entryName.split(/[/\\]/).includes('..');
}

export function listSafeZipEntries(buffer: Buffer): AdmZip.IZipEntry[] {
  let zip: AdmZip;

  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new AppException(
      ErrorCode.INVALID_ZIP,
      'El archivo ZIP está corrupto o no tiene un formato válido.',
      HttpStatus.BAD_REQUEST,
    );
  }

  const entries = zip.getEntries();

  if (entries.length === 0) {
    throw new AppException(
      ErrorCode.INVALID_ZIP,
      'El archivo ZIP no contiene ningún archivo.',
      HttpStatus.BAD_REQUEST,
    );
  }

  for (const entry of entries) {
    if (!isSafeEntryName(entry.entryName)) {
      throw new AppException(
        ErrorCode.INVALID_ZIP,
        `El ZIP contiene una ruta insegura: "${entry.entryName}".`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  return entries;
}

export function assertCompatibleProject(entries: AdmZip.IZipEntry[]): void {
  const filePaths = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.entryName);

  const hasPackageJson = filePaths.some(
    (path) => !isIgnoredPath(path) && path.split('/').pop() === 'package.json',
  );
  const hasTypeScriptFile = filePaths.some((path) => !isIgnoredPath(path) && isSourceFile(path));

  if (!hasPackageJson || !hasTypeScriptFile) {
    throw new AppException(
      ErrorCode.UNSUPPORTED_PROJECT,
      'El proyecto no parece un proyecto TypeScript soportado: falta package.json o archivos .ts/.tsx.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
