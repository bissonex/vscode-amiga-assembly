import {
  window,
  workspace,
  Disposable,
  DiagnosticSeverity,
  TextDocument,
  Uri,
  WorkspaceConfiguration
} from "vscode";
import { ExecutorParser, ICheckResult, ExecutorHelper } from "./execHelper";
import { ExtensionState } from "./extension";
import { VLINKLinker } from "./vlink";
import { AsmONE } from "./asmONE";
import * as path from "path";
import * as winston from 'winston';
import { FileProxy } from "./fsProxy";

/**
 * Class to manage the VASM compiler
 */
export class VASMCompiler {
  static readonly CONFIGURE_VASM_ERROR = new Error(
    "Please configure VASM compiler in the Workspace"
  );
  executor: ExecutorHelper;
  parser: VASMParser;
  linker: VLINKLinker;
  asmONE: AsmONE;

  constructor() {
    this.executor = new ExecutorHelper();
    this.parser = new VASMParser();
    this.linker = new VLINKLinker();
    this.asmONE = new AsmONE();
  }

  /**
   * Builds the file in the current editor
   */
  public buildCurrentEditorFile(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const editor = window.activeTextEditor;
      if (editor) {
        let conf = workspace.getConfiguration("amiga-assembly.vasm");
        if (this.mayCompile(conf)) {
          await this.buildDocument(editor.document, true)
            .then(() => {
              resolve();
            })
            .catch(err => {
              reject(err);
            });
        } else {
          reject(
            new Error("VASM compilation is disabled in the configuration")
          );
        }
      } else {
        reject(new Error("There is no active editor"));
      }
    });
  }

  /**
   * Build the selected document
   * @param document The document to build
   * @param temporaryBuild If true the build will be done in the tmp dir
   */
  public buildDocument(document: TextDocument, temporaryBuild: boolean): Promise<ICheckResult[]> {
    return new Promise((resolve, reject) => {
      this.buildFile(document.uri, false, temporaryBuild)
        .then(([_objectFile, errors]) => {
          this.processGlobalErrors(document, errors);
          this.executor.handleDiagnosticErrors(
            document,
            errors,
            DiagnosticSeverity.Error
          );
          if (errors) {
            resolve(errors);
          } else {
            resolve(new Array<ICheckResult>());
          }
        })
        .catch(err => {
          reject(err);
        });
    });
  }

  /**
   * Find lines for the global errors
   * @param document Test document
   * @param errors Errors
   */
  public processGlobalErrors(document: TextDocument, errors: ICheckResult[]) {
    for (let i = 0; i < errors.length; i += 1) {
      let error = errors[i];
      if (error.line <= 0) {
        // match include errors
        let match = /.*[<](.*)+[>]/.exec(error.msg);
        if (match) {
          let regexp = new RegExp(
            '^[\\s]+include[\\s]+"' +
            match[1].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"),
            "i"
          );
          for (let k = 0; k < document.lineCount; k += 1) {
            let line = document.lineAt(k).text;
            if (line.match(regexp)) {
              error.line = k + 1;
              break;
            }
          }
        }
      }
      if (error.file.length <= 0) {
        error.file = document.fileName;
      }
    }
  }

  public buildWorkspace(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      let state = ExtensionState.getCurrent();
      let warningDiagnosticCollection = state.getWarningDiagnosticCollection();
      let errorDiagnosticCollection = state.getErrorDiagnosticCollection();
      errorDiagnosticCollection.clear();
      warningDiagnosticCollection.clear();
      let configuration = workspace.getConfiguration("amiga-assembly", null);
      let conf: any = configuration.get("vasm");
      if (this.mayCompile(conf)) {
        let confVLINK: any = configuration.get("vlink");
        if (confVLINK) {
          let includes = confVLINK.includes;
          let excludes = confVLINK.excludes;
          let exefilename = confVLINK.exefilename;
          let entrypoint = confVLINK.entrypoint;
          await this.buildWorkspaceInner(
            includes,
            excludes,
            exefilename,
            entrypoint
          )
            .then(() => {
              resolve();
            })
            .catch(err => {
              reject(err);
            });
        } else {
          reject(new Error("Please configure VLINK compiler files selection"));
        }
      } else if (!this.disabledInConf(conf)) {
        reject(VASMCompiler.CONFIGURE_VASM_ERROR);
      } else {
        resolve();
      }
    });
  }

  /**
   * CLeans the workspace
   */
  public cleanWorkspace(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      let state = ExtensionState.getCurrent();
      let warningDiagnosticCollection = state.getWarningDiagnosticCollection();
      let errorDiagnosticCollection = state.getErrorDiagnosticCollection();
      winston.info("Cleaning workspace");
      errorDiagnosticCollection.clear();
      warningDiagnosticCollection.clear();
      let configuration = workspace.getConfiguration("amiga-assembly", null);
      let conf: any = configuration.get("vasm");
      if (this.mayCompile(conf)) {
        const buildDir = this.getBuildDir();
        await buildDir.findFiles("**/*.o", "").then(filesProxies => {
          for (let i = 0; i < filesProxies.length; i++) {
            const fileUri = filesProxies[i];
            winston.info(
              `Deleting ${fileUri.getPath()}`
            );
            fileUri.delete();
          }
          resolve();
        });
      } else if (!this.disabledInConf(conf)) {
        reject(VASMCompiler.CONFIGURE_VASM_ERROR);
      } else {
        resolve();
      }
    });
  }

  /**
   * Returns the build directory
   * Useful for tests
   */
  public getBuildDir(): FileProxy {
    return ExtensionState.getCurrent().getBuildDir();
  }

  /**
   * Returns the temp directory
   * Useful for tests
   */
  public getTmpDir(): FileProxy {
    return ExtensionState.getCurrent().getTmpDir();
  }

  /**
   * Returns the workspace root directory
   * Useful for tests
   */
  public getWorkspaceRootDir(): Uri | null {
    return ExtensionState.getCurrent().getWorkspaceRootDir();
  }

  private buildWorkspaceInner(
    includes: string,
    excludes: string,
    exefilename: string,
    entrypoint: string | undefined
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const workspaceRootDir = this.getWorkspaceRootDir();
      const buildDir = this.getBuildDir();
      const configuration = workspace.getConfiguration("amiga-assembly", null);
      const confVLINK: any = configuration.get("vlink");
      const ASMOneEnabled = this.isASMOneEnabled();
      if (workspaceRootDir && buildDir) {
        await workspace.findFiles(includes, excludes).then(async filesURI => {
          let promises: Thenable<ICheckResult[]>[] = [];
          for (let i = 0; i < filesURI.length; i++) {
            const fileUri = filesURI[i];
            promises.push(
              workspace.openTextDocument(fileUri).then(document => {
                return this.buildDocument(document, false);
              })
            );
          }
          await Promise.all(promises)
            .then(async errorsArray => {
              for (let i = 0; i < errorsArray.length; i += 1) {
                let errors: ICheckResult[] = errorsArray[i];
                if (ASMOneEnabled) {
                  errors = this.asmONE.filterErrors(errors);
                }
                if (errors && errors.length > 0) {
                  reject(new Error("Build aborted: there are compile errors"));
                }
              }
              // Call the linker
              if (this.linker.mayLink(confVLINK)) {
                await this.linker
                  .linkFiles(
                    filesURI,
                    exefilename,
                    entrypoint,
                    workspaceRootDir,
                    buildDir.getUri()
                  )
                  .then(errors => {
                    if (errors && errors.length > 0) {
                      reject(new Error(`Linker error: ${errors[0].msg}`));
                    } else {
                      if (ASMOneEnabled) {
                        this.asmONE.Auto(
                          filesURI,
                          buildDir.getRelativeFile(exefilename).getUri()
                        );
                      }
                      resolve();
                    }
                  })
                  .catch(err => {
                    reject(err);
                  });
              } else {
                // The linker is not mandatory
                // show a warning in the output
                winston.warn(
                  "Warning : the linker vlink is not configured"
                );
                resolve();
              }
            })
            .catch(err => {
              reject(err);
            });
        });
      } else {
        reject(new Error("Root workspace or build path not found"));
      }
    });
  }

  /**
   * Build the selected file
   * @param filepathname Path of the file to build
   * @param debug If true debug symbols are added
   * @param temporaryBuild If true the ile will go to the temp folder
   * @param bootblock If true it will build a bootblock 
   */
  public buildFile(fileUri: Uri, debug: boolean, temporaryBuild: boolean, bootblock?: boolean): Promise<[string | null, ICheckResult[]]> {
    return new Promise(async (resolve, reject) => {
      const workspaceRootDir = this.getWorkspaceRootDir();
      let buildDir: FileProxy;
      if (temporaryBuild) {
        buildDir = this.getTmpDir();
      } else {
        buildDir = this.getBuildDir();
      }
      if (workspaceRootDir && buildDir) {
        let filename = path.basename(fileUri.fsPath);
        let configuration = workspace.getConfiguration("amiga-assembly", null);
        let conf: any = configuration.get("vasm");
        if (this.mayCompile(conf)) {
          try {
            await buildDir.mkdir();
          } catch (err) {
            reject(new Error(`Error creating the  build dir "${buildDir}: ` + err.toString()));
            return;
          }
          let state = ExtensionState.getCurrent();
          let warningDiagnosticCollection = state.getWarningDiagnosticCollection();
          let errorDiagnosticCollection = state.getErrorDiagnosticCollection();
          let vasmExecutableName: string = conf.file;
          let extSep = filename.indexOf(".");
          let objFilename: string;
          if (extSep > 0) {
            objFilename = path.join(
              buildDir.getPath(),
              filename.substr(0, filename.lastIndexOf(".")) + ".o"
            );
          } else {
            objFilename = path.join(buildDir.getPath(), filename + ".o");
          }
          let confArgs: any;
          if (bootblock) {
            if (conf.options && (conf.options.length > 0)) {
              confArgs = conf.options;
            } else {
              confArgs = new Array<string>();
              confArgs.push("-m68000");
            }
            confArgs.push("-Fbin");
          } else {
            confArgs = conf.options;
          }
          if (debug) {
            confArgs.push("-linedebug");
          }
          let args: Array<string> = confArgs.concat([
            "-o",
            objFilename,
            fileUri.fsPath
          ]);
          errorDiagnosticCollection.delete(fileUri);
          warningDiagnosticCollection.delete(fileUri);
          await this.executor
            .runTool(
              args,
              workspaceRootDir.fsPath,
              "warning",
              true,
              vasmExecutableName,
              null,
              true,
              this.parser
            )
            .then(results => {
              resolve([objFilename, results]);
            })
            .catch(err => {
              reject(err);
              return;
            });
        } else if (!this.disabledInConf(conf)) {
          reject(VASMCompiler.CONFIGURE_VASM_ERROR);
        } else {
          resolve(["", new Array<ICheckResult>()]);
        }
      } else {
        reject(new Error("Root workspace path not found"));
      }
    });
  }

  /**
   * Function to check if it is possible to compile.
   * Useful for mocking
   * @param conf Configuration
   */
  mayCompile(conf: WorkspaceConfiguration) {
    return conf && conf.enabled;
  }

  /**
   * Function to check if it is explicitly disabled
   * @param conf Configuration
   */
  disabledInConf(conf: WorkspaceConfiguration) {
    return conf && !conf.enabled;
  }

  /**
   * Checks if ASMOne compatibility is enabled.
   */
  isASMOneEnabled(): boolean {
    let conf = workspace.getConfiguration("amiga-assembly", null);
    if (conf) {
      return conf.ASMOneCompatibilityEnabled === true;
    }
    return false;
  }
}

export class VASMController {
  private disposable: Disposable;
  private compiler: VASMCompiler;

  constructor(compiler: VASMCompiler) {
    this.compiler = compiler;
    // subscribe to selection change and editor activation events
    let subscriptions: Disposable[] = [];
    workspace.onDidSaveTextDocument(
      document => {
        this.onSaveDocument(document);
      },
      null,
      subscriptions
    );

    // create a combined disposable from both event subscriptions
    this.disposable = Disposable.from(...subscriptions);
  }

  public async onSaveDocument(document: TextDocument) {
    let state = ExtensionState.getCurrent();
    let statusManager = state.getStatusManager();
    if (document.languageId === "m68k") {
      statusManager.onDefault();
      await this.compiler.buildDocument(document, true).catch(error => {
        statusManager.onError(error.message);
      });
    }
  }

  dispose() {
    this.disposable.dispose();
  }
}

export class VASMParser implements ExecutorParser {
  parse(text: string): ICheckResult[] {
    let errors: ICheckResult[] = [];
    let lines = text.split(/\r\n|\r|\n/g);
    let error: ICheckResult | undefined = undefined;
    let lastHeaderLine = "";
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      let line = lines[lineIndex];
      if (line.length > 1) {
        if (!line.startsWith(">")) {
          let match = /(error|warning|message)\s([\d]+)\sin\sline\s([\d]+)\sof\s[\"](.+)[\"]:\s*(.*)/.exec(
            line
          );
          if (match) {
            if (error !== undefined) {
              errors.push(error);
            }
            error = new ICheckResult();
            lastHeaderLine = line;
            error.file = match[4];
            error.line = parseInt(match[3]);
            error.msg = match[1] + " " + match[2] + ": " + match[5];
            error.msgData = this.collectErrorData(lines, lineIndex + 1);
            error.severity = match[1];
          } else {
            match = /.*error\s([\d]+)\s*:\s*(.*)/.exec(line);
            if (match) {
              if (error !== undefined) {
                errors.push(error);
              }
              error = new ICheckResult();
              lastHeaderLine = line;
              error.severity = "error";
              error.msg = line;
            } else if (error !== undefined) {
              // Errors details parse
              match = /\s*called from line\s([\d]+)\sof\s[\"](.+)[\"]/.exec(
                line
              );
              if (match) {
                error.file = match[2];
                error.line = parseInt(match[1]);
                error.msg = lastHeaderLine;
              } else {
                match = /\s*included from line\s([\d]+)\sof\s[\"](.+)[\"]/.exec(
                  line
                );
                if (match) {
                  // It's an included file
                  error.parentFile = match[2];
                }
              }
            }
          }
        }
      }
    }
    // Pushes the last error
    if (error !== undefined) {
      errors.push(error);
    }
    return errors;
  }

  /**
   * Collects error data from lines below detected error
   * @param lines output error lines
   * @param idx index of line to start collecting data, should be after error
   */
  private collectErrorData(lines: string[], idx: number): string {
    let errData = "";
    if (idx >= lines.length) {
      return errData;
    }
    while (idx < lines.length && lines[idx].startsWith(">")) {
      errData += lines[idx++] + "\n";
    }
    return errData;
  }
}
