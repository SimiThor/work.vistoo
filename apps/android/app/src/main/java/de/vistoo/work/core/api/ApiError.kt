package de.vistoo.work.core.api

import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.TaskItem
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Every failure of an API call, with a German user-facing message. */
class ApiError(
    val kind: Kind,
    override val message: String,
    val status: Int? = null,
    val fieldErrors: Map<String, String> = emptyMap(),
    /** For task CONFLICTs: the current server state. */
    val currentTask: TaskItem? = null,
) : Exception(message) {
    sealed interface Kind {
        /** No network connection: nothing was (provably) stored. */
        data object Offline : Kind

        /** Connection broke during the request: the server MAY have applied it. */
        data object Interrupted : Kind

        /** The server answered with an error body. */
        data class Server(val code: ErrorCode) : Kind

        /** Unexpected response format (contract mismatch or proxy page). */
        data object InvalidResponse : Kind
        data object Cancelled : Kind
    }

    val code: ErrorCode? get() = (kind as? Kind.Server)?.code

    val isConnectivityProblem: Boolean get() = kind == Kind.Offline || kind == Kind.Interrupted

    companion object {
        val invalidResponse: ApiError
            get() = ApiError(Kind.InvalidResponse, "Unerwartete Antwort vom Server. Bitte versuche es später erneut.")

        fun offline() = ApiError(Kind.Offline, "Keine Verbindung. Bitte prüfe dein Netzwerk und versuche es erneut.")

        fun interrupted() = ApiError(Kind.Interrupted, "Die Verbindung wurde unterbrochen. Bitte versuche es erneut.")

        /** Transport failures → offline (nothing sent) or interrupted (maybe applied). */
        fun from(error: IOException): ApiError = when (error) {
            is UnknownHostException, is ConnectException, is NoRouteToHostException -> offline()
            is SSLException -> offline()
            is InterruptedIOException -> interrupted()
            else -> if (error.message == "Canceled") ApiError(Kind.Cancelled, "Abgebrochen.") else interrupted()
        }
    }
}

/** Message of any error for alerts (non-API errors get a generic text). */
val Throwable.userMessage: String
    get() = (this as? ApiError)?.message ?: "Etwas ist schiefgelaufen. Bitte versuche es erneut."
