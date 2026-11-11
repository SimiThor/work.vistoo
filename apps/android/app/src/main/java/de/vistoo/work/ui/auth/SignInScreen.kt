package de.vistoo.work.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import de.vistoo.work.ui.components.rememberMainScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.stores.AppModel
import de.vistoo.work.ui.components.BrandMark
import de.vistoo.work.ui.components.SmallProgress
import de.vistoo.work.ui.components.cardSurface
import de.vistoo.work.ui.generated.Tokens
import de.vistoo.work.ui.theme.VType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** E-mail → one-time code (same flow as the web login). No passwords, no public sign-up. */
@Composable
fun SignInScreen(app: AppModel) {
    var codeStep by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var verified by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberMainScope()
    val focus = remember { FocusRequester() }

    fun requestCode() {
        val address = email.trim().lowercase()
        if (!address.contains("@") || busy) return
        busy = true
        scope.launch {
            try {
                app.requestCode(address)
                email = address
                error = null
                codeStep = true
            } catch (e: ApiError) {
                error = e.fieldErrors["email"] ?: e.message
            } finally {
                busy = false
            }
        }
    }

    /** Runs once per code: after success the button stays disabled until the app switches screens. */
    fun verify() {
        if (busy || verified) return
        busy = true
        scope.launch {
            val failure = app.verify(email, code)
            error = failure
            if (failure == null) {
                verified = true
            } else {
                code = ""
                busy = false
            }
        }
    }

    LaunchedEffect(codeStep) {
        delay(300)
        runCatching { focus.requestFocus() }
    }

    Box(Modifier.fillMaxSize().background(Tokens.Palette.surfaceSubtle).safeDrawingPadding().imePadding()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BrandMark(modifier = Modifier.padding(top = 48.dp, bottom = 24.dp))
            Column(
                Modifier.widthIn(max = 480.dp).fillMaxWidth().cardSurface().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (!codeStep) {
                    Text("Anmelden", style = VType.pageTitle)
                    Text("Wir senden dir einen Code und einen Anmeldelink per E-Mail.", style = VType.dense, color = Tokens.Palette.mutedForeground)
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("E-Mail-Adresse") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                        keyboardActions = KeyboardActions(onNext = { requestCode() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentType = ContentType.EmailAddress },
                        colors = fieldColors(),
                        shape = RoundedCornerShape(Tokens.Radius.md),
                    )
                    PrimaryButton("Code anfordern", enabled = !busy && email.contains("@"), busy = busy) { requestCode() }
                } else {
                    Text("Code eingeben", style = VType.pageTitle)
                    Text(
                        "Wir haben eine E-Mail an $email gesendet. Gib den Code ein oder öffne den Link auf diesem Gerät.",
                        style = VType.dense,
                        color = Tokens.Palette.mutedForeground,
                    )
                    OutlinedTextField(
                        value = code,
                        onValueChange = { v -> code = v.filter { it.isDigit() }.take(10) },
                        label = { Text("Code aus der E-Mail") },
                        singleLine = true,
                        textStyle = VType.title3.copy(fontFamily = FontFamily.Monospace, letterSpacing = 2.sp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { if (code.length >= 6) verify() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentType = ContentType.SmsOtpCode },
                        colors = fieldColors(),
                        shape = RoundedCornerShape(Tokens.Radius.md),
                    )
                    PrimaryButton("Anmelden", enabled = !busy && code.length >= 6, busy = busy && !verified) { verify() }
                    if (verified) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SmallProgress()
                            Text("Anmeldung …", style = VType.dense, color = Tokens.Palette.mutedForeground)
                        }
                    }
                    TextButton(onClick = {
                        verified = false
                        codeStep = false
                        code = ""
                        error = null
                        busy = false
                    }) { Text("Andere E-Mail-Adresse", style = VType.footnote) }
                }
                val notice = app.signInNotice
                if (notice != null && error == null) Notice(Icons.Outlined.Info, notice, Tokens.Palette.mutedForeground)
                error?.let { Notice(Icons.Outlined.ErrorOutline, it, Tokens.Palette.destructive) }
            }
        }
    }
}

@Composable
private fun Notice(icon: ImageVector, text: String, color: androidx.compose.ui.graphics.Color) {
    Row(Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, null, tint = color, modifier = Modifier.size(16.dp).padding(top = 2.dp))
        Text(text, style = VType.footnote, color = color)
    }
}

@Composable
fun PrimaryButton(text: String, enabled: Boolean, busy: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        shape = RoundedCornerShape(Tokens.Radius.lg),
        colors = ButtonDefaults.buttonColors(containerColor = Tokens.Palette.accentBlue),
    ) {
        if (busy) SmallProgress() else Text(text)
    }
}

@Composable
fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Tokens.Palette.accentBlue,
    unfocusedBorderColor = Tokens.Palette.input,
    focusedLabelColor = Tokens.Palette.accentBlueText,
    cursorColor = Tokens.Palette.accentBlue,
)
