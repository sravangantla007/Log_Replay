from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFApp import XCAFApp_Application
from OCP.RWGltf import RWGltf_CafWriter
from OCP.TColStd import TColStd_IndexedDataMapOfStringString
from OCP.Message import Message_ProgressRange
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDF import TDF_LabelSequence
from OCP.BRepMesh import BRepMesh_IncrementalMesh

app = XCAFApp_Application.GetApplication_s()
doc = TDocStd_Document(TCollection_ExtendedString('MDTV-XCAF'))
app.NewDocument(TCollection_ExtendedString('MDTV-XCAF'), doc)

reader = STEPCAFControl_Reader()
reader.SetNameMode(True)
reader.SetColorMode(True)
reader.SetLayerMode(True)
reader.ReadFile('C:/Users/gvsra/OneDrive/Documents/GitHub/VelR/Rocketry-Avionics/Project_Directory/Avionics_Board_Rev_2/Avionics_Board_Rev_2.step')
reader.Transfer(doc)

shapeTool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
labels = TDF_LabelSequence()
shapeTool.GetFreeShapes(labels)
for i in range(1, labels.Length() + 1):
    shape = shapeTool.GetShape_s(labels.Value(i))
    BRepMesh_IncrementalMesh(shape, 0.1)

writer = RWGltf_CafWriter('board.glb', True)
writer.Perform(doc, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange())
print("Export complete")
