import SwiftUI
import VistooCore

struct ProjectsScreen: View {
    let session: SessionModel
    @State private var editing: ProjectEditorTarget?
    @State private var failure: ActionFailure?
    @State private var showArchived = false

    private var work: WorkStore { session.work }

    var body: some View {
        List {
            if work.activeProjects.isEmpty {
                ContentUnavailableView(
                    "Noch keine Projekte",
                    systemImage: "folder.badge.plus",
                    description: Text("Projekte bündeln Aufgaben, Gruppen und Termine.")
                )
                .listRowBackground(Color.clear)
            }
            Section {
                ForEach(work.activeProjects) { project in
                    NavigationLink(value: ProjectRoute(id: project.id)) {
                        ProjectRow(project: project, stat: work.projectStats[project.id])
                    }
                    .swipeActions {
                        Button { archive(project, true) } label: { Label("Archivieren", systemImage: "archivebox") }
                            .tint(Tokens.Palette.mutedForeground)
                        Button { editing = .edit(project) } label: { Label("Bearbeiten", systemImage: "pencil") }
                            .tint(Tokens.Palette.accentBlue)
                    }
                    .contextMenu { menu(project) }
                }
            }
            if !work.archivedProjects.isEmpty {
                Section(isExpanded: $showArchived) {
                    ForEach(work.archivedProjects) { project in
                        NavigationLink(value: ProjectRoute(id: project.id)) {
                            ProjectRow(project: project, stat: work.projectStats[project.id])
                        }
                        .swipeActions {
                            Button { archive(project, false) } label: { Label("Wiederherstellen", systemImage: "arrow.uturn.backward") }
                                .tint(Tokens.Palette.accentBlue)
                        }
                        .contextMenu { menu(project) }
                    }
                } header: {
                    Text("Archiviert (\(work.archivedProjects.count))")
                }
            }
        }
        .groupedListStyle()
        .navigationTitle("Projekte")
        .refreshable { await work.reload() }
        .toolbar {
            ToolbarItem(placement: .leading) { AccountButton(session: session) }
            ToolbarItem(placement: .trailing) {
                Button { editing = .create } label: { Label("Neues Projekt", systemImage: "plus") }
            }
        }
        .sheet(item: $editing) { target in
            ProjectEditor(session: session, target: target)
        }
        .failureAlert($failure)
    }

    @ViewBuilder private func menu(_ project: Project) -> some View {
        if project.archived {
            Button { archive(project, false) } label: { Label("Wiederherstellen", systemImage: "arrow.uturn.backward") }
        } else {
            Button { editing = .edit(project) } label: { Label("Bearbeiten", systemImage: "pencil") }
            Button { archive(project, true) } label: { Label("Archivieren", systemImage: "archivebox") }
        }
    }

    private func archive(_ project: Project, _ archived: Bool) {
        Task {
            do { try await work.setArchived(project.id, archived) } catch {
                failure = ActionFailure(archived ? "Archivieren fehlgeschlagen" : "Wiederherstellen fehlgeschlagen", error)
            }
        }
    }
}

struct ProjectRow: View {
    let project: Project
    let stat: ProjectStat?

    var body: some View {
        HStack(spacing: Tokens.Spacing.md) {
            ProjectDot(colorKey: project.color)
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(.body)
                if !project.description.isEmpty {
                    Text(project.description).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground).lineLimit(2)
                }
            }
            Spacer()
            if let stat, stat.total > 0 {
                Text("\(stat.done)/\(stat.total)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Tokens.Palette.mutedForeground)
                    .accessibilityLabel("\(stat.done) von \(stat.total) erledigt")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A project's work view (board + timeline), with project actions.
struct ProjectDetailScreen: View {
    let session: SessionModel
    let projectId: String
    @State private var editing: ProjectEditorTarget?
    @State private var failure: ActionFailure?

    var body: some View {
        if let project = session.work.project(projectId) {
            WorkScreen(session: session, scope: .project(projectId), title: project.name) {
                AnyView(Group {
                    if !project.archived {
                        Button { editing = .edit(project) } label: { Label("Projekt bearbeiten", systemImage: "pencil") }
                    }
                    Button {
                        Task {
                            do { try await session.work.setArchived(project.id, !project.archived) } catch {
                                failure = ActionFailure("Aktion fehlgeschlagen", error)
                            }
                        }
                    } label: {
                        project.archived
                            ? Label("Wiederherstellen", systemImage: "arrow.uturn.backward")
                            : Label("Projekt archivieren", systemImage: "archivebox")
                    }
                })
            }
                .sheet(item: $editing) { ProjectEditor(session: session, target: $0) }
                .failureAlert($failure)
        } else {
            ContentUnavailableView("Projekt nicht gefunden", systemImage: "folder.badge.questionmark")
        }
    }
}

enum ProjectEditorTarget: Identifiable {
    case create
    case edit(Project)
    var id: String {
        switch self {
        case .create: "new"
        case .edit(let p): p.id
        }
    }
}

struct ProjectEditor: View {
    let session: SessionModel
    let target: ProjectEditorTarget
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var color = "slate"
    /// Stable client id for "create": retries never duplicate the project.
    @State private var clientId = newClientId()
    @State private var saving = false
    @State private var failure: APIError?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    TextField("Beschreibung (optional)", text: $description, axis: .vertical).lineLimit(2...5)
                }
                Section("Farbe") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 44))], spacing: Tokens.Spacing.md) {
                        ForEach(ProjectColorDefinition.all, id: \.key) { c in
                            Button { color = c.key } label: {
                                Circle()
                                    .fill(Color(hex: c.hex))
                                    .frame(width: 30, height: 30)
                                    .overlay(Circle().strokeBorder(.white, lineWidth: color == c.key ? 3 : 0))
                                    .overlay(Circle().strokeBorder(Tokens.Palette.foreground.opacity(color == c.key ? 0.6 : 0), lineWidth: 1))
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(c.label)
                            .accessibilityAddTraits(color == c.key ? .isSelected : [])
                        }
                    }
                }
                if let failure {
                    Section { Text(failure.fieldErrors["name"] ?? failure.message).foregroundStyle(Tokens.Palette.destructive) }
                }
            }
            .navigationTitle(isCreate ? "Neues Projekt" : "Projekt bearbeiten")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreate ? "Erstellen" : "Sichern") { Task { await save() } }
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                if case .edit(let p) = target {
                    name = p.name
                    description = p.description
                    color = p.color
                }
            }
        }
    }

    private var isCreate: Bool { if case .create = target { true } else { false } }

    private func save() async {
        saving = true
        defer { saving = false }
        let n = name.trimmingCharacters(in: .whitespaces)
        let d = description.trimmingCharacters(in: .whitespaces)
        do {
            switch target {
            case .create: _ = try await session.work.createProject(id: clientId, name: n, description: d, color: color)
            case .edit(let p): try await session.work.updateProject(p.id, name: n, description: d, color: color)
            }
            dismiss()
        } catch {
            failure = error
        }
    }
}
