import AdmZip from 'adm-zip';

/** Contraparte de `listSafeZipEntries`: empaqueta un directorio ya materializado en disco. */
export function zipDirectory(dir: string): Buffer {
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  return zip.toBuffer();
}
