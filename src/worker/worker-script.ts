import type { LammpsModule, InternalLammpsWeb } from "../types.js";

// SharedArrayBuffer references
let metadataBuffer: Int32Array | null = null;
let positionsBuffer: Float64Array | null = null;
let lammps: InternalLammpsWeb | null = null;
let wasmModule: LammpsModule | null = null;

// Metadata buffer indices
const META_ATOM_COUNT = 0;
const META_TIMESTEP = 1;
const META_CAPACITY = 2;
const META_PAUSE_FLAG = 3;
const META_RESIZE_FLAG = 4;

interface Message {
  id?: string;
  type: string;
  [key: string]: any;
}

// Helper to send response back to main thread
function sendResponse(id: string | undefined, result: any, error?: string) {
  if (id) {
    postMessage({
      id,
      type: "response",
      result,
      error,
    });
  }
}

// Helper to send log message
function sendLog(message: string) {
  postMessage({
    type: "log",
    message,
  });
}

// Helper to send error message
function sendError(message: string) {
  postMessage({
    type: "error",
    message,
  });
}

// Update metadata in SharedArrayBuffer
function updateMetadata() {
  if (!lammps || !metadataBuffer) return;

  Atomics.store(metadataBuffer, META_ATOM_COUNT, lammps.getNumAtoms());
  Atomics.store(metadataBuffer, META_TIMESTEP, lammps.getTimesteps());
}

// Update positions in SharedArrayBuffer
function updatePositions() {
  if (!lammps || !positionsBuffer || !metadataBuffer || !wasmModule) return;

  const numAtoms = lammps.getNumAtoms();
  const capacity = Atomics.load(metadataBuffer, META_CAPACITY);

  if (numAtoms > capacity) {
    // Set resize flag to prevent concurrent access
    Atomics.store(metadataBuffer, META_RESIZE_FLAG, 1);
    
    // Need to resize - notify main thread
    postMessage({
      type: "resize_needed",
      numAtoms,
    });
    
    // Wait for resize to complete (main thread will clear flag)
    while (Atomics.load(metadataBuffer, META_RESIZE_FLAG) === 1) {
      // Busy wait - could use Atomics.wait but that might block too much
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Short sleep
      }
    }
    
    // Reload buffer reference after resize
    // This is set by the init handler when new buffer arrives
    // For now, just return and let next call use new buffer
    return;
  }

  // Check if resize is in progress
  if (Atomics.load(metadataBuffer, META_RESIZE_FLAG) === 1) {
    // Resize in progress, skip this update
    return;
  }

  // IMPORTANT: Call computeParticles() to fill the positions buffer
  lammps.computeParticles();

  // Get positions pointer from LAMMPS
  const positionsPtr = lammps.getPositionsPointer();
  
  if (positionsPtr === 0) {
    return; // No positions available yet
  }

  // Copy positions from WASM memory to SharedArrayBuffer
  // The positions are stored as Float32 in WASM memory
  if (wasmModule.HEAPF32) {
    const sourcePositions = wasmModule.HEAPF32.subarray(
      positionsPtr / 4, // HEAPF32 is indexed in 4-byte chunks
      positionsPtr / 4 + numAtoms * 3
    );
    
    // Copy to SharedArrayBuffer (convert Float32 to Float64)
    for (let i = 0; i < numAtoms * 3; i++) {
      positionsBuffer[i] = sourcePositions[i];
    }
  }
}

// Post-step callback - called after each simulation step
function postStepCallback(): boolean {
  if (!metadataBuffer) return false;

  // Update metadata
  updateMetadata();

  // Send callback signal to main thread
  postMessage({
    type: "callback",
    timestep: lammps?.getTimesteps() || 0,
  });

  // Check pause flag using Atomics
  const pauseFlag = Atomics.load(metadataBuffer, META_PAUSE_FLAG);
  
  if (pauseFlag === 1) {
    // Wait for resume signal
    while (Atomics.load(metadataBuffer, META_PAUSE_FLAG) === 1) {
      // Busy wait - in a real implementation, could use Atomics.wait
      // but that blocks the worker thread completely
      // For now, sleep a bit to avoid spinning
      const start = Date.now();
      while (Date.now() - start < 50) {
        // Short busy wait
      }
    }
  }

  return false; // Continue simulation
}

// Message handlers
const handlers: Record<string, (msg: Message) => void | Promise<void>> = {
  async init(msg: Message) {
    try {
      // Store SharedArrayBuffer references
      if (msg.metadataBuffer) {
        metadataBuffer = new Int32Array(msg.metadataBuffer);
      }
      if (msg.positionsBuffer) {
        positionsBuffer = new Float64Array(msg.positionsBuffer);
        
        // If this is a resize operation, clear the resize flag
        if (metadataBuffer && Atomics.load(metadataBuffer, META_RESIZE_FLAG) === 1) {
          Atomics.store(metadataBuffer, META_RESIZE_FLAG, 0);
        }
      }

      // Only initialize LAMMPS if not already initialized
      if (!lammps) {
        // We need to initialize LAMMPS manually to get access to the Module
        // Import the createModule function directly
        // @ts-ignore - lammps.mjs is generated at build time
        const createModuleImport = await import("../lammps.mjs");
        const createModule = createModuleImport.default;
        
        // Create the module with our options
        const module = await createModule({
          print: (message: string) => sendLog(message),
          printErr: (message: string) => sendError(message),
          ...msg.options,
        });
        
        wasmModule = module;

        // Set up global callback
        (globalThis as any).postStepCallback = postStepCallback;

        // Create LAMMPS instance
        const lammpsInstance = new module.LAMMPSWeb();
        lammpsInstance.start();

        // Store the raw LAMMPS instance
        lammps = lammpsInstance;
      }

      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  runScript(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.runScript(msg.script);
      updateMetadata();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  step(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.step();
      updateMetadata();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  getData(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }

      const data: any = {};

      // Get requested data
      if (msg.fields) {
        for (const field of msg.fields) {
          switch (field) {
            case "numAtoms":
              data.numAtoms = lammps.getNumAtoms();
              break;
            case "timesteps":
              data.timesteps = lammps.getTimesteps();
              break;
            case "memoryUsage":
              data.memoryUsage = lammps.getMemoryUsage();
              break;
            case "isRunning":
              data.isRunning = lammps.getIsRunning();
              break;
            case "timestepsPerSecond":
              data.timestepsPerSecond = lammps.getTimestepsPerSecond();
              break;
            case "positions":
              updatePositions();
              data.positionsUpdated = true;
              break;
            default:
              console.warn(`Unknown field: ${field}`);
          }
        }
      }

      updateMetadata();
      sendResponse(msg.id, data);
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  updatePositions(msg: Message) {
    try {
      updatePositions();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  pause(msg: Message) {
    try {
      if (!metadataBuffer) {
        throw new Error("Metadata buffer not initialized");
      }
      Atomics.store(metadataBuffer, META_PAUSE_FLAG, 1);
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  resume(msg: Message) {
    try {
      if (!metadataBuffer) {
        throw new Error("Metadata buffer not initialized");
      }
      Atomics.store(metadataBuffer, META_PAUSE_FLAG, 0);
      Atomics.notify(metadataBuffer, META_PAUSE_FLAG, 1);
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  cancel(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.cancel();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  syncComputes(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.syncComputes();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  syncFixes(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.syncFixes();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  syncVariables(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.syncVariables();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  stop(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.stop();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  start(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.start();
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },

  setPaused(msg: Message) {
    try {
      if (!lammps) {
        throw new Error("LAMMPS not initialized");
      }
      lammps.setPaused(msg.paused);
      sendResponse(msg.id, { success: true });
    } catch (error: any) {
      sendResponse(msg.id, null, error.message);
    }
  },
};

// Listen for messages from main thread
self.onmessage = async (event: MessageEvent<Message>) => {
  const msg = event.data;
  const handler = handlers[msg.type];

  if (handler) {
    await handler(msg);
  } else {
    console.warn(`Unknown message type: ${msg.type}`);
    sendResponse(msg.id, null, `Unknown message type: ${msg.type}`);
  }
};

