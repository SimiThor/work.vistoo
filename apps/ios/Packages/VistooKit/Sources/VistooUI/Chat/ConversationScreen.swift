import PhotosUI
import QuickLook
import SwiftUI
import UniformTypeIdentifiers
import VistooCore

/// One conversation: stable scrolling (anchored at the bottom, older pages
/// prepend without jumps), composer above the keyboard, attachments via the
/// system pickers, files opened via Quick Look (which offers sharing).
struct ConversationScreen: View {
    let session: SessionModel
    let conversationId: String

    @State private var position = ScrollPosition(idType: String.self)
    @State private var showDetails = false
    @State private var editing: Message?
    @State private var editText = ""
    @State private var deleting: Message?
    @State private var preview: URL?
    @State private var downloading: String?
    @State private var failure: ActionFailure?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var sent = 0
    @Environment(\.scenePhase) private var scenePhase

    private var model: ConversationModel { session.chat.model(for: conversationId) }

    var body: some View {
        dialogs(pickers(lifecycle(screen)))
    }

    private var screen: some View {
        content
            .navigationTitle(model.detail?.title ?? session.chat.summary(conversationId)?.title ?? "Unterhaltung")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .trailing) {
                    Button { showDetails = true } label: { Label("Details", systemImage: "info.circle") }
                        .disabled(model.detail == nil)
                }
            }
            .safeAreaInset(edge: .bottom) { composerArea }
    }

    private func lifecycle(_ view: some View) -> some View {
        view
            .task {
                model.isVisible = true
                session.watchConversation(conversationId)
                if model.state == .loaded { await model.catchUp() } else { await model.load() }
            }
            .onDisappear {
                model.isVisible = false
                session.watchConversation(nil)
            }
            .onChange(of: scenePhase) { _, phase in model.isVisible = phase == .active }
            .sensoryFeedback(.success, trigger: sent)
    }

    private func pickers(_ view: some View) -> some View {
        view
            .photosPicker(
                isPresented: $showPhotos,
                selection: $photoItems,
                maxSelectionCount: max(1, session.limits.maxFilesPerMessage - model.attachments.count),
                matching: .images
            )
            .onChange(of: photoItems) { _, items in
                guard !items.isEmpty else { return }
                photoItems = []
                Task { await addPhotos(items) }
            }
            .fileImporter(
                isPresented: $showFiles,
                allowedContentTypes: AttachmentTypes.contentTypes(session.limits),
                allowsMultipleSelection: true
            ) { result in
                if case .success(let urls) = result { Task { await addFiles(urls) } }
            }
            .quickLookPreview($preview)
    }

    private func dialogs(_ view: some View) -> some View {
        view
            .sheet(isPresented: $showDetails) {
                ConversationDetailsView(session: session, model: model)
            }
            .sheet(item: $editing) { message in editSheet(message) }
            .confirmationDialog(
                "Nachricht löschen?",
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                titleVisibility: .visible,
                presenting: deleting
            ) { message in
                Button("Löschen", role: .destructive) {
                    Task {
                        do { try await model.delete(message.id) } catch { failure = ActionFailure("Löschen fehlgeschlagen", error) }
                    }
                }
            } message: { _ in
                Text("Die Nachricht und ihre Anhänge werden entfernt. Ein Platzhalter bleibt sichtbar.")
            }
            .failureAlert($failure)
    }

    @ViewBuilder private var content: some View {
        if model.messages.isEmpty, model.state != .loaded {
            if case .failed(let message) = model.state {
                FailureView(message: message) { await model.load() }
            } else {
                LoadingView()
            }
        } else {
            messages
        }
    }

    private var messages: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if model.hasOlder {
                    Button {
                        Task { await loadOlder() }
                    } label: {
                        if model.isLoadingOlder { ProgressView() } else { Text("Ältere Nachrichten laden") }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Tokens.Spacing.md)
                    .onAppear { Task { await loadOlder() } }
                } else if let detail = model.detail {
                    ConversationIntro(detail: detail).padding(.bottom, Tokens.Spacing.md)
                }
                ForEach(Array(model.messages.enumerated()), id: \.element.id) { index, message in
                    let previous = index > 0 ? model.messages[index - 1] : nil
                    if previous.map({ !Calendar.current.isDate($0.createdAt, inSameDayAs: message.createdAt) }) ?? true {
                        DayDivider(date: message.createdAt)
                    }
                    MessageRow(
                        message: message,
                        author: model.author(message.authorId),
                        compact: previous.map { $0.authorId == message.authorId && message.createdAt.timeIntervalSince($0.createdAt) < 300 } ?? false,
                        isOwn: message.authorId == session.userId,
                        downloading: downloading,
                        onOpenAttachment: { open($0) }
                    )
                    .contextMenu { messageMenu(message) }
                    .id(message.id)
                }
                ForEach(model.pending) { pending in
                    PendingMessageRow(
                        pending: pending,
                        retry: { Task { await model.retry(pending.id) } },
                        discard: { model.discard(pending.id) }
                    )
                    .id(pending.id)
                }
            }
            .padding(.horizontal, Tokens.Spacing.lg)
            .padding(.bottom, Tokens.Spacing.sm)
            .scrollTargetLayout()
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geo in
            geo.contentOffset.y + geo.containerSize.height >= geo.contentSize.height - 60
        } action: { _, atBottom in
            model.isAtBottom = atBottom
        }
        .onChange(of: model.messages.last?.id) { _, _ in
            // Follow new messages only when the reader is already at the end.
            if model.isAtBottom, let last = model.pending.last?.id ?? model.messages.last?.id {
                withAnimation { position.scrollTo(id: last, anchor: .bottom) }
            }
        }
        .onChange(of: model.pending.count) { old, new in
            if new > old, let last = model.pending.last?.id { position.scrollTo(id: last, anchor: .bottom) }
        }
    }

    /// Prepends older messages and keeps the previously first message in place.
    private func loadOlder() async {
        guard model.hasOlder, !model.isLoadingOlder else { return }
        let anchor = model.messages.first?.id
        await model.loadOlder()
        if let anchor { position.scrollTo(id: anchor, anchor: .top) }
    }

    // MARK: Composer

    @ViewBuilder private var composerArea: some View {
        if let detail = model.detail, !detail.canPost {
            Label(
                detail.readOnlyReason == .archived
                    ? "Dieser Kanal ist archiviert. Neue Nachrichten sind nicht möglich."
                    : "Diese Person ist kein aktives Mitglied mehr. Die Unterhaltung ist schreibgeschützt.",
                systemImage: "lock"
            )
            .font(.footnote)
            .foregroundStyle(Tokens.Palette.mutedForeground)
            .frame(maxWidth: .infinity)
            .padding()
            .background(.bar)
        } else if model.detail != nil {
            Composer(
                model: model,
                limits: session.limits,
                onPhotos: { showPhotos = true },
                onFiles: { showFiles = true },
                onSend: {
                    Task {
                        await model.send()
                        sent += 1
                    }
                }
            )
        }
    }

    // MARK: Message actions

    @ViewBuilder private func messageMenu(_ message: Message) -> some View {
        if !message.deleted {
            if !message.body.isEmpty {
                Button {
                    Clipboard.copy(message.body)
                } label: { Label("Kopieren", systemImage: "doc.on.doc") }
            }
            if message.authorId == session.userId {
                if model.canPost {
                    Button {
                        editText = message.body
                        editing = message
                    } label: { Label("Bearbeiten", systemImage: "pencil") }
                }
                Button(role: .destructive) { deleting = message } label: { Label("Löschen …", systemImage: "trash") }
            }
        }
    }

    private func editSheet(_ message: Message) -> some View {
        NavigationStack {
            Form {
                TextField("Nachricht", text: $editText, axis: .vertical).lineLimit(3...12)
                if editText.count > session.limits.maxMessageLength {
                    Text("Eine Nachricht darf höchstens \(session.limits.maxMessageLength) Zeichen lang sein.")
                        .foregroundStyle(Tokens.Palette.destructive)
                }
            }
            .navigationTitle("Nachricht bearbeiten")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { editing = nil } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sichern") {
                        let text = editText
                        editing = nil
                        Task {
                            do { try await model.edit(message.id, body: text) } catch { failure = ActionFailure("Nicht gespeichert", error) }
                        }
                    }
                    .disabled(editText.count > session.limits.maxMessageLength
                              || (editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && message.attachments.isEmpty))
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: Files

    private func open(_ attachment: Attachment) {
        guard downloading == nil else { return }
        downloading = attachment.id
        Task {
            defer { downloading = nil }
            do { preview = try await model.download(attachment) } catch {
                failure = ActionFailure("Datei nicht geöffnet", error)
            }
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        for (i, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                failure = ActionFailure("Bild nicht geladen", message: "Das Bild konnte nicht gelesen werden.")
                continue
            }
            // Photos are often HEIC: convert to JPEG (on the allowlist).
            guard let jpeg = ImageConversion.jpeg(from: data) else {
                failure = ActionFailure("Bild nicht geladen", message: "Dieses Bildformat wird nicht unterstützt.")
                continue
            }
            let name = "Foto-\(Date.now.formatted(.iso8601.year().month().day()))-\(i + 1).jpg"
            if let problem = await model.addAttachment(data: jpeg, fileName: name, limits: session.limits) {
                failure = ActionFailure("Anhang nicht möglich", message: problem)
            }
        }
    }

    private func addFiles(_ urls: [URL]) async {
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            // Check size before reading the file into memory.
            if let problem = model.precheck(fileName: url.lastPathComponent, sizeBytes: size, limits: session.limits) {
                failure = ActionFailure("Anhang nicht möglich", message: problem)
                continue
            }
            guard let data = try? Data(contentsOf: url) else {
                failure = ActionFailure("Datei nicht gelesen", message: "„\(url.lastPathComponent)“ konnte nicht gelesen werden.")
                continue
            }
            if let problem = await model.addAttachment(data: data, fileName: url.lastPathComponent, limits: session.limits) {
                failure = ActionFailure("Anhang nicht möglich", message: problem)
            }
        }
    }
}

// MARK: - Pieces

struct Composer: View {
    @Bindable var model: ConversationModel
    let limits: Limits
    let onPhotos: () -> Void
    let onFiles: () -> Void
    let onSend: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: Tokens.Spacing.sm) {
            if !model.attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(model.attachments) { a in
                            ComposerAttachmentChip(attachment: a) { Task { await model.removeAttachment(a.id) } }
                        }
                    }
                }
            }
            if model.draft.count > limits.maxMessageLength {
                Text("Eine Nachricht darf höchstens \(limits.maxMessageLength.formatted(.number.locale(Formatting.locale))) Zeichen lang sein.")
                    .font(.caption)
                    .foregroundStyle(Tokens.Palette.destructive)
            }
            HStack(alignment: .bottom, spacing: Tokens.Spacing.sm) {
                Menu {
                    Button(action: onPhotos) { Label("Fotos", systemImage: "photo") }
                    Button(action: onFiles) { Label("Dateien", systemImage: "folder") }
                } label: {
                    Image(systemName: "paperclip")
                        .font(.title3)
                        .frame(width: 36, height: 36)
                }
                .disabled(model.attachments.count >= limits.maxFilesPerMessage)
                .accessibilityLabel("Anhang hinzufügen")

                TextField("Nachricht", text: $model.draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, Tokens.Spacing.md)
                    .padding(.vertical, Tokens.Spacing.sm)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Tokens.Palette.surfaceSubtle))

                Button(action: onSend) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(model.canSend && model.draft.count <= limits.maxMessageLength ? Tokens.Palette.accentBlue : Tokens.Palette.borderStrong)
                }
                .disabled(!model.canSend || model.draft.count > limits.maxMessageLength)
                .accessibilityLabel("Senden")
            }
        }
        .padding(.horizontal, Tokens.Spacing.md)
        .padding(.vertical, Tokens.Spacing.sm)
        .background(.bar)
    }
}

struct ComposerAttachmentChip: View {
    let attachment: ComposerAttachment
    let remove: () -> Void
    var body: some View {
        HStack(spacing: Tokens.Spacing.xs) {
            switch attachment.state {
            case .uploading: ProgressView().controlSize(.small)
            case .ready: Image(systemName: "doc").foregroundStyle(Tokens.Palette.mutedForeground)
            case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Tokens.Palette.destructive)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(attachment.fileName).font(.caption).lineLimit(1)
                if case .failed(let message) = attachment.state {
                    Text(message).font(.caption2).foregroundStyle(Tokens.Palette.destructive).lineLimit(2)
                } else {
                    Text(ByteFormatting.string(attachment.sizeBytes)).font(.caption2).foregroundStyle(Tokens.Palette.mutedForeground)
                }
            }
            Button(action: remove) { Image(systemName: "xmark.circle.fill").foregroundStyle(Tokens.Palette.mutedForeground) }
                .buttonStyle(.plain)
                .accessibilityLabel("„\(attachment.fileName)“ entfernen")
        }
        .padding(Tokens.Spacing.sm)
        .frame(maxWidth: 220)
        .cardSurface()
    }
}

struct MessageRow: View {
    let message: Message
    let author: ChatPerson?
    let compact: Bool
    let isOwn: Bool
    let downloading: String?
    let onOpenAttachment: (Attachment) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            if compact {
                Color.clear.frame(width: 32, height: 1)
            } else {
                Avatar(fullName: author?.fullName, email: author?.email, size: 32)
            }
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                if !compact {
                    HStack(alignment: .firstTextBaseline, spacing: Tokens.Spacing.sm) {
                        Text(author?.displayName ?? "Ehemaliges Mitglied").font(.subheadline.weight(.semibold))
                        Text(Formatting.time(message.createdAt)).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
                    }
                }
                if message.deleted {
                    Text("Nachricht gelöscht").italic().foregroundStyle(Tokens.Palette.mutedForeground)
                } else {
                    if !message.body.isEmpty {
                        (Text(LinkedText.attributed(message.body))
                            + Text(message.editedAt != nil ? " (bearbeitet)" : "").font(.caption).foregroundColor(Tokens.Palette.mutedForeground))
                            .textSelection(.enabled)
                    }
                    ForEach(message.attachments) { a in
                        AttachmentCard(attachment: a, loading: downloading == a.id) { onOpenAttachment(a) }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, compact ? 2 : Tokens.Spacing.md)
        .accessibilityElement(children: .combine)
    }
}

struct PendingMessageRow: View {
    let pending: PendingMessage
    let retry: () -> Void
    let discard: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            Color.clear.frame(width: 32, height: 1)
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                if !pending.body.isEmpty { Text(pending.body).foregroundStyle(Tokens.Palette.mutedForeground) }
                ForEach(pending.attachments) { a in
                    Label(a.fileName, systemImage: "doc").font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
                }
                if let failure = pending.failure {
                    Text("Nicht gesendet: \(failure)").font(.caption).foregroundStyle(Tokens.Palette.destructive)
                    HStack {
                        Button("Erneut senden", action: retry).font(.caption.weight(.semibold))
                        Button("Verwerfen", role: .destructive, action: discard).font(.caption)
                    }
                } else {
                    Label("Wird gesendet …", systemImage: "clock").font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
                }
            }
        }
        .padding(.top, Tokens.Spacing.sm)
        .accessibilityElement(children: .contain)
    }
}

struct AttachmentCard: View {
    let attachment: Attachment
    let loading: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: Tokens.Spacing.md) {
                Image(systemName: icon).font(.title3).foregroundStyle(Tokens.Palette.accentBlue).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(attachment.fileName).font(.subheadline).lineLimit(1)
                    Text(ByteFormatting.string(attachment.sizeBytes)).font(.caption).foregroundStyle(Tokens.Palette.mutedForeground)
                }
                Spacer()
                if loading { ProgressView() } else { Image(systemName: "arrow.down.circle").foregroundStyle(Tokens.Palette.mutedForeground) }
            }
            .padding(Tokens.Spacing.md)
            .frame(maxWidth: 320)
            .cardSurface()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Datei \(attachment.fileName), \(ByteFormatting.string(attachment.sizeBytes))")
        .accessibilityHint("Lädt die Datei und öffnet sie")
    }

    private var icon: String {
        if attachment.mimeType.hasPrefix("image/") { return "photo" }
        if attachment.mimeType == "application/pdf" { return "doc.richtext" }
        return "doc"
    }
}

struct DayDivider: View {
    let date: Date
    var body: some View {
        HStack {
            VStack { Divider() }
            Text(Formatting.dayHeading(date)).font(.caption.weight(.medium)).foregroundStyle(Tokens.Palette.mutedForeground)
            VStack { Divider() }
        }
        .padding(.vertical, Tokens.Spacing.md)
        .accessibilityAddTraits(.isHeader)
    }
}

struct ConversationIntro: View {
    let detail: ConversationDetail
    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(detail.kind == .dm ? detail.title : "# \(detail.title)").font(Tokens.Typography.sectionTitle)
            Text(detail.description.isEmpty
                 ? (detail.kind == .dm ? "Der Anfang eurer Unterhaltung." : "Der Anfang des Kanals.")
                 : detail.description)
                .font(.subheadline)
                .foregroundStyle(Tokens.Palette.mutedForeground)
        }
        .padding(.top, Tokens.Spacing.lg)
    }
}

/// Plain text with clickable links (no HTML/Markdown, like the web).
enum LinkedText {
    static func attributed(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return result }
        let ns = text as NSString
        for match in detector.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            guard let url = match.url, url.scheme == "https" || url.scheme == "http" || url.scheme == "mailto",
                  let range = Range(match.range, in: text),
                  let lower = AttributedString.Index(range.lowerBound, within: result),
                  let upper = AttributedString.Index(range.upperBound, within: result)
            else { continue }
            result[lower..<upper].link = url
        }
        return result
    }
}

enum Clipboard {
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

enum AttachmentTypes {
    /// System file picker types from the server allowlist.
    static func contentTypes(_ limits: Limits) -> [UTType] {
        limits.allowedFileTypes.flatMap { $0.extensions.compactMap { UTType(filenameExtension: $0) } }
    }
}

enum ImageConversion {
    /// Re-encodes any image (e.g. HEIC) as JPEG with ImageIO (no UIKit needed).
    /// Orientation is kept; location metadata (GPS) is removed before upload.
    static func jpeg(from data: Data, quality: Double = 0.85) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: quality,
            kCGImageMetadataShouldExcludeGPS: true,
        ]
        CGImageDestinationAddImageFromSource(dest, source, 0, options as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }
}
