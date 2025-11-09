import type { LammpsModuleOptions } from "../types.js";

// Metadata buffer indices (must match worker-script.ts)
const META_ATOM_COUNT = 0;
const META_TIMESTEP = 1;
const META_CAPACITY = 2;
const META_PAUSE_FLAG = 3;
const META_SIZE = 4; // Total size of metadata buffer

type EventCallback = (...args: any[]) => void;

interface WorkerMessage {
  id?: string;
  type: string;
  [key: string]: any;
}

export interface LammpsWorkerOptions extends Omit<LammpsModuleOptions, 'postStepCallback'> {
  workerUrl?: string;
  initialCapacity?: number;
}

/**
 * LammpsWorker wraps a Web Worker running LAMMPS with SharedArrayBuffer for efficient data sharing.
 * 
 * @example
 * ```typescript
 * const lammps = await LammpsWorker.create({
 *   workerUrl: './dist/worker/worker-entry.js'
 * });
 * 
 * lammps.on('log', msg => console.log(msg));
 * lammps.on('step', () => {
 *   console.log('Timestep:', lammps.getTimesteps());
 * });
 * 
 * await lammps.runScript('units lj');
 * console.log('Atoms:', lammps.getNumAtoms());
 * ```
 */
export class LammpsWorker {
  private worker: Worker;
  private metadataBuffer: SharedArrayBuffer;
  private metadataView: Int32Array;
  private positionsBuffer: SharedArrayBuffer;
  private positionsView: Float64Array;
  private messageId = 0;
  private pendingMessages = new Map<string, { resolve: Function; reject: Function }>();
  private eventListeners = new Map<string, Set<EventCallback>>();

  private constructor(
    worker: Worker,
    metadataBuffer: SharedArrayBuffer,
    positionsBuffer: SharedArrayBuffer
  ) {
    this.worker = worker;
    this.metadataBuffer = metadataBuffer;
    this.metadataView = new Int32Array(metadataBuffer);
    this.positionsBuffer = positionsBuffer;
    this.positionsView = new Float64Array(positionsBuffer);

    // Set up message handler
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = (error) => {
      console.error("Worker error:", error);
      this.emit("error", error.message);
    };
  }

  /**
   * Create a new LammpsWorker instance.
   * 
   * @param options - Configuration options
   * @returns Promise that resolves to a LammpsWorker instance
   */
  static async create(options: LammpsWorkerOptions = {}): Promise<LammpsWorker> {
    // Determine worker URL
    const workerUrl = options.workerUrl || new URL('./worker-entry.js', import.meta.url).href;

    // Create worker
    const worker = new Worker(workerUrl, { type: 'module' });

    // Create SharedArrayBuffers
    const initialCapacity = options.initialCapacity || 100000; // Default capacity for 100k atoms
    const metadataBuffer = new SharedArrayBuffer(META_SIZE * Int32Array.BYTES_PER_ELEMENT);
    const positionsBuffer = new SharedArrayBuffer(initialCapacity * 3 * Float64Array.BYTES_PER_ELEMENT);

    // Initialize metadata
    const metadataView = new Int32Array(metadataBuffer);
    Atomics.store(metadataView, META_ATOM_COUNT, 0);
    Atomics.store(metadataView, META_TIMESTEP, 0);
    Atomics.store(metadataView, META_CAPACITY, initialCapacity);
    Atomics.store(metadataView, META_PAUSE_FLAG, 0);

    // Create instance
    const instance = new LammpsWorker(worker, metadataBuffer, positionsBuffer);

    // Initialize LAMMPS in worker
    await instance.sendCommand("init", {
      metadataBuffer,
      positionsBuffer,
      options: {
        print: options.print,
        printErr: options.printErr,
        locateFile: options.locateFile,
        wasmBinary: options.wasmBinary,
      },
    });

    return instance;
  }

  /**
   * Handle messages from worker
   */
  private handleMessage(event: MessageEvent<WorkerMessage>) {
    const msg = event.data;

    switch (msg.type) {
      case "response":
        // Handle command response
        if (msg.id) {
          const pending = this.pendingMessages.get(msg.id);
          if (pending) {
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg.result);
            }
            this.pendingMessages.delete(msg.id);
          }
        }
        break;

      case "log":
        this.emit("log", msg.message);
        break;

      case "error":
        this.emit("error", msg.message);
        break;

      case "callback":
        this.emit("step", msg.timestep);
        break;

      case "resize_needed":
        this.resizePositionsBuffer(msg.numAtoms);
        break;

      default:
        console.warn("Unknown message type from worker:", msg.type);
    }
  }

  /**
   * Resize positions buffer when needed
   */
  private async resizePositionsBuffer(numAtoms: number) {
    const newCapacity = Math.max(numAtoms * 2, 1000);
    const newBuffer = new SharedArrayBuffer(newCapacity * 3 * Float64Array.BYTES_PER_ELEMENT);

    // Copy existing data
    const oldView = this.positionsView;
    const newView = new Float64Array(newBuffer);
    const copyLength = Math.min(oldView.length, newView.length);
    for (let i = 0; i < copyLength; i++) {
      newView[i] = oldView[i];
    }

    // Update capacity in metadata
    Atomics.store(this.metadataView, META_CAPACITY, newCapacity);

    // Update references
    this.positionsBuffer = newBuffer;
    this.positionsView = newView;

    // Send new buffer to worker
    await this.sendCommand("init", {
      positionsBuffer: newBuffer,
    });
  }

  /**
   * Send a command to the worker and wait for response
   */
  private sendCommand(type: string, data: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `msg_${this.messageId++}`;
      this.pendingMessages.set(id, { resolve, reject });

      this.worker.postMessage({
        id,
        type,
        ...data,
      });

      // Set timeout for command
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Command timeout: ${type}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Register an event listener
   */
  on(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Unregister an event listener
   */
  off(event: string, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(...args));
    }
  }

  // LAMMPS API methods

  /**
   * Execute LAMMPS commands
   */
  async runScript(script: string): Promise<void> {
    await this.sendCommand("runScript", { script });
  }

  /**
   * Advance simulation by one timestep
   */
  async step(): Promise<void> {
    await this.sendCommand("step");
  }

  /**
   * Get number of atoms (reads from SharedArrayBuffer)
   */
  getNumAtoms(): number {
    return Atomics.load(this.metadataView, META_ATOM_COUNT);
  }

  /**
   * Get current timestep (reads from SharedArrayBuffer)
   */
  getTimesteps(): number {
    return Atomics.load(this.metadataView, META_TIMESTEP);
  }

  /**
   * Get atom positions (view into SharedArrayBuffer)
   * Returns a view of [x1, y1, z1, x2, y2, z2, ...]
   */
  getPositions(): Float64Array {
    const numAtoms = this.getNumAtoms();
    return this.positionsView.subarray(0, numAtoms * 3);
  }

  /**
   * Request worker to update positions in SharedArrayBuffer
   */
  async updatePositions(): Promise<void> {
    await this.sendCommand("updatePositions");
  }

  /**
   * Get data from worker
   */
  async getData(fields: string[]): Promise<any> {
    return await this.sendCommand("getData", { fields });
  }

  /**
   * Pause the simulation
   */
  async pause(): Promise<void> {
    await this.sendCommand("pause");
  }

  /**
   * Resume the simulation
   */
  async resume(): Promise<void> {
    await this.sendCommand("resume");
  }

  /**
   * Cancel the simulation
   */
  async cancel(): Promise<void> {
    await this.sendCommand("cancel");
  }

  /**
   * Stop LAMMPS
   */
  async stop(): Promise<void> {
    await this.sendCommand("stop");
  }

  /**
   * Start LAMMPS
   */
  async start(): Promise<void> {
    await this.sendCommand("start");
  }

  /**
   * Set paused state
   */
  async setPaused(paused: boolean): Promise<void> {
    await this.sendCommand("setPaused", { paused });
  }

  /**
   * Sync computes
   */
  async syncComputes(): Promise<void> {
    await this.sendCommand("syncComputes");
  }

  /**
   * Sync fixes
   */
  async syncFixes(): Promise<void> {
    await this.sendCommand("syncFixes");
  }

  /**
   * Sync variables
   */
  async syncVariables(): Promise<void> {
    await this.sendCommand("syncVariables");
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    this.worker.terminate();
    this.pendingMessages.clear();
    this.eventListeners.clear();
  }
}

