# LAMMPS

LAMMPS (Large-scale Atomic/Molecular Massively Parallel Simulator) compiled to WebAssembly for use in web browsers and Node.js environments.

## Installation

```bash
npm install lammps
```

## Quick Start

```typescript
import { LammpsWeb } from "lammps";

// Create a LAMMPS instance
const lammps = await LammpsWeb.create({
  print: (msg) => console.log(msg),
  printErr: (msg) => console.error(msg),
  postStepCallback: () => {
    // Called after each simulation step
    // Return false to continue, true to pause
    console.log("Step:", lammps.getTimesteps());
    return false;
  },
});

// Run LAMMPS commands
lammps.runScript(`
  units lj
  atom_style atomic
  lattice fcc 0.8442
  region box block 0 4 0 4 0 4
  create_box 1 box
  create_atoms 1 box
`);

// Get system information
console.log("Number of atoms:", lammps.getNumAtoms());
console.log("Timesteps:", lammps.getTimesteps());

// Control simulation
lammps.step();
```

## API Reference

### LammpsWeb

The main class for interacting with LAMMPS.

#### Static Methods

##### `create(options?)`

Creates a new LAMMPS instance.

**Parameters:**
- `options.print?: (msg: string) => void` - Callback for standard output
- `options.printErr?: (msg: string) => void` - Callback for error output
- `options.postStepCallback?: () => boolean` - Callback invoked after each simulation step. Return `false` to continue simulation, `true` to pause.

**Returns:** `Promise<LammpsWeb>`

**Example:**
```typescript
const lammps = await LammpsWeb.create({
  print: (msg) => console.log(msg),
  printErr: (msg) => console.error(msg),
  postStepCallback: () => {
    // Called after each simulation step
    // Return false to continue, true to pause
    return false;
  },
});
```

#### Instance Methods

##### Simulation Control

- `runScript(script: string): void` - Execute LAMMPS commands (single or multi-line)
- `runFile(path: string): void` - Execute commands from a file
- `start(): boolean` - Start the simulation
- `stop(): boolean` - Stop the simulation
- `step(): void` - Advance simulation by one timestep
- `setPaused(paused: boolean): void` - Pause/unpause the simulation
- `cancel(): void` - Cancel the current simulation

##### System Information

- `getNumAtoms(): number` - Get the number of atoms in the system
- `getTimesteps(): number` - Get the current timestep
- `getRunTimesteps(): number` - Get timesteps in current run
- `getRunTotalTimesteps(): number` - Get total timesteps to run
- `getTimestepsPerSecond(): number` - Get simulation performance
- `getIsRunning(): boolean` - Check if simulation is running
- `getMemoryUsage(): number` - Get memory usage in bytes

##### Computes, Fixes, and Variables

- `getCompute(name: string): LMPModifier` - Get a compute by name
- `getComputeNames(): CPPArray<string>` - Get all compute names
- `getFix(name: string): LMPModifier` - Get a fix by name
- `getFixNames(): CPPArray<string>` - Get all fix names
- `getVariable(name: string): LMPModifier` - Get a variable by name
- `getVariableNames(): CPPArray<string>` - Get all variable names
- `syncComputes(): void` - Synchronize all computes
- `syncFixes(): void` - Synchronize all fixes
- `syncVariables(): void` - Synchronize all variables

##### Direct Memory Access

These methods provide pointers to LAMMPS internal data structures for high-performance access:

- `getPositionsPointer(): number` - Get pointer to atom positions
- `getIdPointer(): number` - Get pointer to atom IDs
- `getTypePointer(): number` - Get pointer to atom types
- `getCellMatrixPointer(): number` - Get pointer to cell matrix
- `getOrigoPointer(): number` - Get pointer to origin
- `getBondsPosition1Pointer(): number` - Get pointer to bond positions (atom 1)
- `getBondsPosition2Pointer(): number` - Get pointer to bond positions (atom 2)
- `getBondsDistanceMapPointer(): number` - Get pointer to bond distance map

##### Other Methods

- `computeBonds(): number` - Compute bonds in the system
- `computeParticles(): number` - Compute particle data
- `setSyncFrequency(every: number): void` - Set synchronization frequency
- `setBuildNeighborlist(build: boolean): void` - Enable/disable neighbor list building
- `getErrorMessage(): string` - Get last error message
- `getLastCommand(): string` - Get last executed command

## Advanced Usage

For advanced users who need direct access to the underlying WASM module:

```typescript
import { createModule } from "lammps";

const Module = await createModule({
  print: (msg) => console.log(msg),
  printErr: (msg) => console.error(msg),
});

// Access the raw LAMMPS instance
const lammps = new Module.LAMMPSWeb();

// Access WASM heap
const positions = Module.HEAPF64.subarray(
  lammps.getPositionsPointer() / 8,
  lammps.getPositionsPointer() / 8 + lammps.getNumAtoms() * 3
);
```

## TypeScript Support

This package includes full TypeScript type definitions. All types are exported for your convenience:

```typescript
import type {
  LammpsWeb,
  LMPModifier,
  CPPArray,
  Compute,
  Fix,
  Variable,
  Data1D,
  ModifierType,
} from "lammps";
```

## File System Access

LAMMPS WASM includes an in-memory file system. You can write files to it before running simulations:

```typescript
import { createModule, LammpsWeb } from "lammps";

const lammps = await LammpsWeb.create();

// Access the module to use the file system
const Module = await createModule({});

// Write a file to the virtual file system
Module.FS.writeFile("/input.lammps", `
units lj
atom_style atomic
lattice fcc 0.8442
region box block 0 4 0 4 0 4
create_box 1 box
create_atoms 1 box
`);

// Run the file
lammps.runFile("/input.lammps");
```

## Examples

### Running a Simple LJ Simulation

```typescript
import { LammpsWeb } from "lammps";

const lammps = await LammpsWeb.create({
  print: (msg) => console.log(msg),
});

// Setup and run simulation
lammps.runScript(`
  units lj
  atom_style atomic
  lattice fcc 0.8442
  region box block 0 10 0 10 0 10
  create_box 1 box
  create_atoms 1 box
  mass 1 1.0
  pair_style lj/cut 2.5
  pair_coeff 1 1 1.0 1.0 2.5
  
  run 1000
`);

console.log(`Simulated ${lammps.getNumAtoms()} atoms`);
```

### Using Computes

```typescript
import { LammpsWeb } from "lammps";

const lammps = await LammpsWeb.create();

// Setup system and define computes
lammps.runScript(`
  compute myTemp all temp
  compute myPE all pe
`);

// Sync computes
lammps.syncComputes();

// Get compute data
const temp = lammps.getCompute("myTemp");
console.log("Temperature:", temp.getScalarValue());

const pe = lammps.getCompute("myPE");
console.log("Potential Energy:", pe.getScalarValue());
```

### Using Step Callbacks

Monitor your simulation progress or update UI by using the `postStepCallback`:

```typescript
import { LammpsWeb } from "lammps";

let stepCount = 0;

const lammps = await LammpsWeb.create({
  postStepCallback: () => {
    stepCount++;
    
    // Update progress every 100 steps
    if (stepCount % 100 === 0) {
      console.log(`Completed ${stepCount} steps`);
      console.log(`Current timestep: ${lammps.getTimesteps()}`);
      console.log(`Atoms: ${lammps.getNumAtoms()}`);
    }
    
    // Return false to continue, true to pause
    // For example, pause after 1000 steps:
    if (stepCount >= 1000) {
      console.log("Reached 1000 steps, pausing...");
      return true;
    }
    
    return false;
  },
});

// Setup and run simulation
lammps.runScript(`
  units lj
  atom_style atomic
  lattice fcc 0.8442
  region box block 0 10 0 10 0 10
  create_box 1 box
  create_atoms 1 box
  
  run 2000
`);
```

## Building from Source

If you want to build the WASM module from source:

```bash
# Install Emscripten SDK
# Set EMSDK_PATH environment variable

# Build LAMMPS WASM
cd ../cpp
python build.py

# Build the package
cd ../package
npm install
npm run build
```

## License

GPL-2.0

## Credits

This package is part of the [Atomify](https://github.com/andeplane/atomify) project and wraps [LAMMPS](https://www.lammps.org/) compiled to WebAssembly.

LAMMPS is developed by Sandia National Laboratories.

