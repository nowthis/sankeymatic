// Sample Diagram recipes showing some popular diagram types.
//
// Planning to make these more elaborate / sophisticated as the tool's 
// capabilities improve...
//
// They're currently just super-long string literals; I preferred that to making
// this a very /tall/ file with a difficult-to-follow structure.

var sample_diagram_recipes = {

// The initial diagram loaded on the page:
'default_budget': {
    name: 'Basic Budget',
    flows: "// Enter Flows between Nodes, like this:\n//         Source [AMOUNT] Target\n\nWages [1500] Budget\nOther [250] Budget\n\nBudget [450] Taxes\nBudget [420] Housing\nBudget [400] Food\nBudget [295] Transportation\nBudget [25] Savings\n\n// You can set a specific color for a Node:\n:Taxes #90C\n\n//                    ...and for a single Flow:\nBudget [160] Other Necessities #0F0\n\n// After entering your data, use the\n// controls below to customize your\n// diagram's appearance.",
    },

// Ranked-choice election
'election': {
    name: 'Ranked Election',
    flows: '// Sample Ranked Election diagram\n\n// First set up Node orders & colors:\n:GH - Round 1 #F93\n:EF - Round 1 #39F\n:CD - Round 1 #96F\n:AB - Round 1 #3F9\n\n:GH - Round 2 #F93\n:EF - Round 2 #39F\n:CD - Round 2 #96F\n\n:GH - Round 3 #F93\n:EF - Round 3 #39F\n:No further votes #555 <<\n\n// Then list the Flow data:\nAB - Round 1 [20000] No further votes\nAB - Round 1 [10000] GH - Round 2\nAB - Round 1 [20000] CD - Round 2\nAB - Round 1 [25000] EF - Round 2\n\nCD - Round 1 [200000] CD - Round 2\nGH - Round 1 [300000] GH - Round 2\nEF - Round 1 [220000] EF - Round 2\n\nCD - Round 2 [50000] GH - Round 3\nCD - Round 2 [95000] EF - Round 3\nCD - Round 2 [75000] No further votes\n\nGH - Round 2 [310000] GH - Round 3\nEF - Round 2 [245000] EF - Round 3',
    },

// Sample job-hunt flow
'job_search': {
    name: 'Job Search',
    flows: '// Sample Job Search diagram:\n\n// Flows:\nApplications [3] Interview\nInterview [2] 2nd Interview\n2nd Interview [2] Offer\nOffer [1] Accepted\nOffer [1] Declined\nInterview [1] No Offer\nApplications [7] Rejected\nApplications [3] No Answer\n\n// Node definitions & Colors:\n:Applications #396\n:Interview #0C0 <<\n:Rejected #F90 <<\n:No Answer #DDD <<\n:No Offer #F90 <<\n:2nd Interview #0C0\n:Offer #0C0\n:Accepted #0C0\n:Declined #96F <<',
    },

// A variation of the inputs for the original d3 energy diagram, now found
// at https://observablehq.com/@d3/sankey
// (This will become a button when I can also include _settings_ in the recipe.)
'energy_flows_all': {
    name: 'Energy Flows',
    flows: ":Losses #900 <<\n:Coal #444 <<\nAgricultural 'waste' [124.729] Bio-conversion\nBio-conversion [0.597] Liquid\nBio-conversion [26.862] Losses\nBio-conversion [280.322] Solid\nBio-conversion [81.144] Gas\nBiofuel imports [35] Liquid\nBiomass imports [35] Solid\nCoal imports [11.606] Coal\nCoal reserves [63.965] Coal\nCoal [75.571] Solid\nDistrict heating [10.639] Industry\nDistrict heating [22.505] Heating and cooling - commercial\nDistrict heating [46.184] Heating and cooling - homes\nElectricity grid [104.453] Over generation / exports\nElectricity grid [113.726] Heating and cooling - homes\nElectricity grid [27.14] H2 conversion\nElectricity grid [342.165] Industry\nElectricity grid [37.797] Road transport\nElectricity grid [4.412] Agriculture\nElectricity grid [40.858] Heating and cooling - commercial\nElectricity grid [56.691] Losses\nElectricity grid [7.863] Rail transport\nElectricity grid [90.008] Lighting & appliances - commercial\nElectricity grid [93.494] Lighting & appliances - homes\nGas imports [40.719] Ngas\nGas reserves [82.233] Ngas\nGas [0.129] Heating and cooling - commercial\nGas [1.401] Losses\nGas [151.891] Thermal generation\nGas [2.096] Agriculture\nGas [48.58] Industry\nGeothermal [7.013] Electricity grid\nH2 conversion [20.897] H2\nH2 conversion [6.242] Losses\nH2 [20.897] Road transport\nHydro [6.995] Electricity grid\nLiquid [121.066] Industry\nLiquid [128.69] International shipping\nLiquid [135.835] Road transport\nLiquid [14.458] Domestic aviation\nLiquid [206.267] International aviation\nLiquid [3.64] Agriculture\nLiquid [33.218] National navigation\nLiquid [4.413] Rail transport\nMarine algae [4.375] Bio-conversion\nNgas [122.952] Gas\nNuclear [839.978] Thermal generation\nOil imports [504.287] Oil\nOil reserves [107.703] Oil\nOil [611.99] Liquid\nOther waste [56.587] Solid\nOther waste [77.81] Bio-conversion\nPumped heat [193.026] Heating and cooling - homes\nPumped heat [70.672] Heating and cooling - commercial\nSolar PV [59.901] Electricity grid\nSolar Thermal [19.263] Heating and cooling - homes\nSolar [19.263] Solar Thermal\nSolar [59.901] Solar PV\nSolid [0.882] Agriculture\nSolid [400.12] Thermal generation\nSolid [46.477] Industry\nThermal generation [525.531] Electricity grid\nThermal generation [787.129] Losses\nThermal generation [79.329] District heating\nTidal [9.452] Electricity grid\nUK land based bioenergy [182.01] Bio-conversion\nWave [19.013] Electricity grid\nWind [289.366] Electricity grid",
    },
};
