export type Locale = "it" | "en";

const strings = {
  it: {
    appTitle: "Mappatura Scaffali",
    ownerDashboard: "Progetti",
    newProject: "Nuovo progetto",
    projectName: "Nome progetto",
    chooseFloorplan: "Planimetria",
    useTreviglio: "Usa Treviglio (predefinito)",
    uploadFloorplan: "Carica immagine",
    createProject: "Crea progetto",
    noProjects: "Nessun progetto. Creane uno per iniziare.",
    pinCount: "{count} scaffali",
    copyShareLink: "Copia link",
    linkCopied: "Link copiato!",
    viewResults: "Vedi risultati",
    shareLink: "Link condivisione",
    created: "Creato",
    submitted: "Inviato",
    draft: "Bozza",
    locked: "Bloccato",

    // Mapper
    shelves: "{count} scaffali",
    submit: "Invia",
    submittedThankYou: "Grazie! La mappatura è stata inviata.",
    submittedNote: "Puoi ancora modificare finché il proprietario non blocca il progetto.",
    zoomIn: "Zoom +",
    zoomOut: "Zoom −",
    fit: "Adatta",
    undo: "Annulla",
    saved: "Salvato",
    saving: "Salvataggio…",
    selectPin: "Seleziona uno scaffale",
    addCategory: "Aggiungi categoria",
    categoryPlaceholder: "Es. Pasta e riso",
    label: "Etichetta (opzionale)",
    labelPlaceholder: "Es. Corsia pasta",
    note: "Nota (opzionale)",
    notePlaceholder: "Note aggiuntive…",
    deletePin: "Elimina",
    deleteConfirm: "Eliminare lo scaffale #{number}?",
    renumber: "Rinumera",
    renumberConfirm: "Rinumerare tutti gli scaffali in ordine? I numeri cambieranno.",
    search: "Cerca…",
    unassigned: "Senza categoria",
    export: "Esporta",
    exportXlsx: "Excel (.xlsx)",
    exportCsv: "CSV",
    exportJson: "JSON",
    showList: "Lista",
    showMap: "Mappa",
    readOnly: "Progetto bloccato — sola lettura",

    // Hint overlay
    hint1: "1. Clicca su uno scaffale per aggiungere un numero.",
    hint2: "2. Scrivi la categoria.",
    hint3: "3. Premi Invia quando hai finito.",
    hintDismiss: "Clicca per iniziare",

    // Results
    resultsTitle: "Risultati",
    resultsUnauthorized: "Accesso negato. Secret non valido.",
    tableNumber: "#",
    tableLabel: "Etichetta",
    tableCategories: "Categorie",
    tableNote: "Nota",
    tableX: "X",
    tableY: "Y",
    backToMapper: "Torna alla mappa",
    noPins: "Nessuno scaffale mappato.",

    // Errors
    loadError: "Impossibile caricare il progetto.",
    createError: "Errore nella creazione del progetto.",
    submitError: "Errore durante l'invio.",
  },
  en: {
    appTitle: "Shelf Mapper",
    ownerDashboard: "Projects",
    newProject: "New project",
    projectName: "Project name",
    chooseFloorplan: "Floorplan",
    useTreviglio: "Use Treviglio (default)",
    uploadFloorplan: "Upload image",
    createProject: "Create project",
    noProjects: "No projects yet. Create one to get started.",
    pinCount: "{count} shelves",
    copyShareLink: "Copy link",
    linkCopied: "Link copied!",
    viewResults: "View results",
    shareLink: "Share link",
    created: "Created",
    submitted: "Submitted",
    draft: "Draft",
    locked: "Locked",

    shelves: "{count} shelves",
    submit: "Submit",
    submittedThankYou: "Thank you! Your mapping has been submitted.",
    submittedNote: "You can still edit until the owner locks the project.",
    zoomIn: "Zoom +",
    zoomOut: "Zoom −",
    fit: "Fit",
    undo: "Undo",
    saved: "Saved",
    saving: "Saving…",
    selectPin: "Select a shelf",
    addCategory: "Add category",
    categoryPlaceholder: "E.g. Pasta & rice",
    label: "Label (optional)",
    labelPlaceholder: "E.g. Pasta aisle",
    note: "Note (optional)",
    notePlaceholder: "Additional notes…",
    deletePin: "Delete",
    deleteConfirm: "Delete shelf #{number}?",
    renumber: "Renumber",
    renumberConfirm: "Renumber all shelves in order? Numbers will change.",
    search: "Search…",
    unassigned: "Unassigned",
    export: "Export",
    exportXlsx: "Excel (.xlsx)",
    exportCsv: "CSV",
    exportJson: "JSON",
    showList: "List",
    showMap: "Map",
    readOnly: "Project locked — read only",

    hint1: "1. Click a shelf to add a number.",
    hint2: "2. Type the category.",
    hint3: "3. Press Submit when done.",
    hintDismiss: "Click to start",

    resultsTitle: "Results",
    resultsUnauthorized: "Access denied. Invalid secret.",
    tableNumber: "#",
    tableLabel: "Label",
    tableCategories: "Categories",
    tableNote: "Note",
    tableX: "X",
    tableY: "Y",
    backToMapper: "Back to map",
    noPins: "No shelves mapped.",

    loadError: "Could not load project.",
    createError: "Error creating project.",
    submitError: "Error submitting.",
  },
} as const;

export type I18nKey = keyof typeof strings.it;

let currentLocale: Locale = "it";

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let text: string = strings[currentLocale][key] ?? strings.it[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

export { strings };
