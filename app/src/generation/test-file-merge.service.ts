import { Injectable } from '@nestjs/common';
import { Node, Project } from 'ts-morph';

@Injectable()
export class TestFileMergeService {
  /**
   * CREATE: no existe un test file relevante todavía; el contenido generado
   * se usa tal cual como archivo nuevo.
   */
  applyCreate(generatedContent: string): string {
    return `${generatedContent.trim()}\n`;
  }

  /**
   * MERGE: agrega el contenido generado a un test file ya existente sin
   * tocar las pruebas actuales. Los imports del contenido generado que no
   * existan todavía se agregan (por module specifier + named imports); los
   * statements no-import (los bloques de test en sí) se agregan al final del
   * archivo, preservando el resto intacto.
   */
  applyMerge(existingContent: string, generatedContent: string): string {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: false } });
    const existingFile = project.createSourceFile('existing.ts', existingContent);
    const generatedFile = project.createSourceFile('generated.ts', generatedContent);

    for (const generatedImport of generatedFile.getImportDeclarations()) {
      const moduleSpecifier = generatedImport.getModuleSpecifierValue();
      const existingImport = existingFile
        .getImportDeclarations()
        .find((imp) => imp.getModuleSpecifierValue() === moduleSpecifier);

      if (!existingImport) {
        existingFile.addImportDeclaration(generatedImport.getStructure());
        continue;
      }

      const existingNamedImports = new Set(
        existingImport.getNamedImports().map((named) => named.getName()),
      );

      for (const named of generatedImport.getNamedImports()) {
        if (!existingNamedImports.has(named.getName())) {
          existingImport.addNamedImport(named.getName());
        }
      }
    }

    const nonImportStatements = generatedFile
      .getStatements()
      .filter((statement) => !Node.isImportDeclaration(statement));

    for (const statement of nonImportStatements) {
      existingFile.addStatements(`\n${statement.getFullText().trim()}`);
    }

    return existingFile.getFullText();
  }
}
