import gmsh
import sys
import os

step_file = r"C:\Users\gvsra\OneDrive\Documents\GitHub\VelR\Rocketry-Avionics\Project_Directory\Avionics_Board_Rev_2\Avionics_Board_Rev_2.step"
stl_file = "board.stl"

if not os.path.exists(step_file):
    print(f"Error: {step_file} not found.")
    sys.exit(1)

print("Initializing gmsh...")
gmsh.initialize()
gmsh.option.setNumber("Mesh.MeshSizeFactor", 0.3)  # Adjust for detail
print(f"Merging {step_file}...")
gmsh.merge(step_file)
print("Generating mesh...")
gmsh.model.mesh.generate(2)
print(f"Writing {stl_file}...")
gmsh.write(stl_file)
gmsh.finalize()
print("Done.")
