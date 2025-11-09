import { LammpsWeb } from "./dist/index.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log("🚀 Initializing LAMMPS...");
  
  // Read the WASM file into memory for Node.js
  const wasmPath = join(__dirname, "dist", "lammps.wasm");
  const wasmBinary = readFileSync(wasmPath);
  
  // Create LAMMPS instance with print callbacks and WASM binary
  const lammps = await LammpsWeb.create({
    print: (msg: string) => console.log("LAMMPS:", msg),
    printErr: (msg: string) => console.error("LAMMPS ERROR:", msg),
    wasmBinary: wasmBinary,
    postStepCallback: () => {
      console.log('callback');
      return false;
    },
  });

  console.log("✅ LAMMPS initialized successfully\n");

  // Run LAMMPS commands
  console.log("📝 Setting up simulation...");
  
  const commands = [
    "units lj",
    "atom_style atomic",
    "lattice fcc 0.8442",
    "region box block 0 3 0 3 0 3",
    "create_box 1 box",
    "create_atoms 1 box",
    "mass 1 1.0",
    "pair_style lj/cut 2.5",
    "pair_coeff 1 1 1.0 1.0 2.5",
  ];

  for (const cmd of commands) {
    console.log(`  Running: ${cmd}`);
    lammps.runCommand(cmd);
  }

  console.log(`\n✅ Created ${lammps.getNumAtoms()} atoms\n`);

  // Run simulation
  console.log("🏃 Running 100 timesteps...");
  lammps.runCommand("run 100");

  // Get final stats  
  console.log("\n📊 Simulation Statistics:");
  console.log(`  Total atoms: ${lammps.getNumAtoms()}`);
  console.log(`  Timesteps: ${lammps.getTimesteps()}`);
  console.log(`  Memory usage: ${(lammps.getMemoryUsage() / 1024 / 1024).toFixed(2)} MB`);

  console.log("\n✅ Simulation complete!");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

