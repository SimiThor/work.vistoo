import SwiftUI
import VistooCore

/// E-mail → one-time code (same flow as the web login). No passwords, no public sign-up.
struct SignInView: View {
    let model: AppModel

    private enum Step { case email, code }
    @State private var step = Step.email
    @State private var email = ""
    @State private var code = ""
    @State private var busy = false
    @State private var verified = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Tokens.Spacing.xl) {
                    BrandMark().padding(.top, Tokens.Spacing.xxl)

                    VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                        if step == .email { emailStep } else { codeStep }
                        if let notice = model.signInNotice, error == nil {
                            Label(notice, systemImage: "info.circle")
                                .font(.footnote)
                                .foregroundStyle(Tokens.Palette.mutedForeground)
                        }
                        if let error {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.footnote)
                                .foregroundStyle(Tokens.Palette.destructive)
                                .accessibilityAddTraits(.isStaticText)
                        }
                    }
                    .padding(Tokens.Spacing.xl)
                    .cardSurface()
                    .padding(.horizontal, Tokens.Spacing.lg)
                }
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .background(Tokens.Palette.surfaceSubtle)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Text("Anmelden").font(Tokens.Typography.pageTitle)
            Text("Wir senden dir einen Code und einen Anmeldelink per E-Mail.")
                .font(.subheadline)
                .foregroundStyle(Tokens.Palette.mutedForeground)
            TextField("E-Mail-Adresse", text: $email)
                .emailInput()
                .focused($focused)
                .submitLabel(.continue)
                .onSubmit { Task { await requestCode() } }
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("E-Mail-Adresse")
            Button {
                Task { await requestCode() }
            } label: {
                Text("Code anfordern").frame(maxWidth: .infinity, minHeight: 32)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || !email.contains("@"))
        }
        .onAppear { focused = true }
    }

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Text("Code eingeben").font(Tokens.Typography.pageTitle)
            Text("Wir haben eine E-Mail an \(email) gesendet. Gib den Code ein oder öffne den Link auf diesem iPhone.")
                .font(.subheadline)
                .foregroundStyle(Tokens.Palette.mutedForeground)
            TextField("Code aus der E-Mail", text: $code)
                .oneTimeCodeInput()
                .focused($focused)
                .font(.title3.monospacedDigit())
                .textFieldStyle(.roundedBorder)
                .submitLabel(.go)
                .onSubmit { Task { await verify() } }
            Button {
                Task { await verify() }
            } label: {
                Text("Anmelden").frame(maxWidth: .infinity, minHeight: 32)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || code.filter(\.isNumber).count < 6)
            if verified { ProgressView("Anmeldung …") }
            Button("Andere E-Mail-Adresse") {
                verified = false
                step = .email
                code = ""
                error = nil
            }
            .font(.footnote)
        }
        .onAppear { focused = true }
    }

    private func requestCode() async {
        let address = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard address.contains("@"), !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await model.requestCode(email: address)
            email = address
            error = nil
            step = .code
        } catch {
            self.error = error.fieldErrors["email"] ?? error.message
        }
    }

    /// Runs once per code: after success the button stays disabled until the app switches screens.
    private func verify() async {
        guard !busy, !verified else { return }
        busy = true
        error = await model.verify(email: email, code: code)
        if error == nil {
            verified = true
        } else {
            code = ""
            busy = false
        }
    }
}
