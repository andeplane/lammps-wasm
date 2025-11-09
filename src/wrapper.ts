import type {
  InternalLammpsWeb,
  LammpsModuleOptions,
  LMPModifier,
  CPPArray,
} from "./types.js";

// @ts-ignore - This will be resolved from the bundled lammps.mjs at build time
import createModuleImport from "./lammps.mjs";

const createModule = createModuleImport as (options?: LammpsModuleOptions) => Promise<{
  LAMMPSWeb: new () => InternalLammpsWeb;
  [key: string]: any;
}>;

/**
 * LammpsWeb wrapper class that simplifies initialization of the LAMMPS WASM module.
 * 
 * @example
 * ```typescript
 * const lammps = await LammpsWeb.create({
 *   print: (msg) => console.log(msg),
 *   printErr: (msg) => console.error(msg)
 * });
 * 
 * lammps.runScript("units lj");
 * console.log(lammps.getNumAtoms());
 * ```
 */
export class LammpsWeb {
  private constructor(private instance: InternalLammpsWeb) {}

  /**
   * Create a new LammpsWeb instance.
   * 
   * @param options - Configuration options for the LAMMPS module
   * @param options.print - Callback for standard output
   * @param options.printErr - Callback for error output
   * @param options.postStepCallback - Optional callback called after each simulation step (return false to continue, true to pause)
   * @returns Promise that resolves to a LammpsWeb instance
   */
  static async create(options?: LammpsModuleOptions): Promise<LammpsWeb> {
    // Set up global callback required by LAMMPS WASM
    const globalObj = globalThis as any;
    if (!globalObj.postStepCallback) {
      globalObj.postStepCallback = options?.postStepCallback || (() => false);
    }
    
    const Module = await createModule(options || {});
    const instance = new Module.LAMMPSWeb();
    
    // Initialize LAMMPS engine
    instance.start();
    
    return new LammpsWeb(instance);
  }

  // Atom and system information methods
  getNumAtoms(): number {
    return this.instance.getNumAtoms();
  }

  setSyncFrequency(every: number): void {
    this.instance.setSyncFrequency(every);
  }

  setBuildNeighborlist(buildNeighborlist: boolean): void {
    this.instance.setBuildNeighborlist(buildNeighborlist);
  }

  getIsRunning(): boolean {
    return this.instance.getIsRunning();
  }

  getErrorMessage(): string {
    return this.instance.getErrorMessage();
  }

  getLastCommand(): string {
    return this.instance.getLastCommand();
  }

  getTimesteps(): number {
    return this.instance.getTimesteps();
  }

  getRunTimesteps(): number {
    return this.instance.getRunTimesteps();
  }

  getRunTotalTimesteps(): number {
    return this.instance.getRunTotalTimesteps();
  }

  getTimestepsPerSecond(): number {
    return this.instance.getTimestepsPerSecond();
  }

  getCPURemain(): number {
    return this.instance.getCPURemain();
  }

  getWhichFlag(): number {
    return this.instance.getWhichFlag();
  }

  // Compute, fix, and variable methods
  getCompute(name: string): LMPModifier {
    return this.instance.getCompute(name);
  }

  getComputeNames(): CPPArray<string> {
    return this.instance.getComputeNames();
  }

  getFix(name: string): LMPModifier {
    return this.instance.getFix(name);
  }

  getFixNames(): CPPArray<string> {
    return this.instance.getFixNames();
  }

  getVariable(name: string): LMPModifier {
    return this.instance.getVariable(name);
  }

  getVariableNames(): CPPArray<string> {
    return this.instance.getVariableNames();
  }

  syncComputes(): void {
    this.instance.syncComputes();
  }

  syncFixes(): void {
    this.instance.syncFixes();
  }

  syncVariables(): void {
    this.instance.syncVariables();
  }

  getMemoryUsage(): number {
    return this.instance.getMemoryUsage();
  }

  // Pointer methods for direct memory access
  getPositionsPointer(): number {
    return this.instance.getPositionsPointer();
  }

  getIdPointer(): number {
    return this.instance.getIdPointer();
  }

  getTypePointer(): number {
    return this.instance.getTypePointer();
  }

  getCellMatrixPointer(): number {
    return this.instance.getCellMatrixPointer();
  }

  getOrigoPointer(): number {
    return this.instance.getOrigoPointer();
  }

  getBondsPosition1Pointer(): number {
    return this.instance.getBondsPosition1Pointer();
  }

  getBondsPosition2Pointer(): number {
    return this.instance.getBondsPosition2Pointer();
  }

  getBondsDistanceMapPointer(): number {
    return this.instance.getBondsDistanceMapPointer();
  }

  getExceptionMessage(address: number): string {
    return this.instance.getExceptionMessage(address);
  }

  // Simulation control methods
  step(): void {
    this.instance.step();
  }

  stop(): boolean {
    return this.instance.stop();
  }

  start(): boolean {
    return this.instance.start();
  }

  cancel(): void {
    this.instance.cancel();
  }

  setPaused(paused: boolean): void {
    this.instance.setPaused(paused);
  }

  runScript(script: string): void {
    this.instance.runScript(script);
  }

  runFile(path: string): void {
    this.instance.runFile(path);
  }

  // Computation methods
  computeBonds(): number {
    return this.instance.computeBonds();
  }

  computeParticles(): number {
    return this.instance.computeParticles();
  }
}

