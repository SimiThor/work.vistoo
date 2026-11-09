package de.vistoo.work

import de.vistoo.work.core.api.AccessTokenProvider
import de.vistoo.work.core.api.ApiClient
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.generated.ErrorCode
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private lateinit var server: MockWebServer

    private class Tokens : AccessTokenProvider {
        var refreshes = 0
        override suspend fun accessToken() = "old"
        override suspend fun refreshedAccessToken(): String {
            refreshes++
            return "new"
        }
    }

    @Before fun setUp() { server = MockWebServer().apply { start() } }
    @After fun tearDown() { server.shutdown() }

    private fun client(tokens: AccessTokenProvider? = Tokens()) = ApiClient(server.url("/api/v1").toString(), 7, tokens)

    @Test
    fun sendsClientHeaderAndBearer() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"todos":[]}"""))
        client().send(API.listTodos())
        val request = server.takeRequest()
        assertEquals("/api/v1/todos", request.path)
        assertEquals("android/7", request.getHeader("X-Vistoo-Client"))
        assertEquals("Bearer old", request.getHeader("Authorization"))
    }

    @Test
    fun refreshesOnceAfterUnauthenticated() = runBlocking {
        val tokens = Tokens()
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"UNAUTHENTICATED","message":"Bitte melde dich an."}}"""))
        server.enqueue(MockResponse().setBody("""{"todos":[]}"""))
        client(tokens).send(API.listTodos())
        server.takeRequest()
        assertEquals("Bearer new", server.takeRequest().getHeader("Authorization"))
        assertEquals(1, tokens.refreshes)
    }

    @Test
    fun mapsErrorEnvelopeWithFieldErrors() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":{"code":"VALIDATION","message":"Ungültig.","fieldErrors":{"title":"Zu lang."}}}"""))
        try {
            client().send(API.listTodos())
            fail("expected error")
        } catch (e: ApiError) {
            assertEquals(ErrorCode.Validation, e.code)
            assertEquals("Ungültig.", e.message)
            assertEquals("Zu lang.", e.fieldErrors["title"])
        }
    }

    @Test
    fun unknownErrorCodeStaysOpen() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(418).setBody("""{"error":{"code":"TEAPOT","message":"Neu."}}"""))
        try {
            client().send(API.listTodos())
            fail("expected error")
        } catch (e: ApiError) {
            assertEquals("TEAPOT", e.code?.rawValue)
        }
    }

    @Test
    fun offlineIsAConnectivityProblem() = runBlocking {
        val url = server.url("/api/v1").toString()
        server.shutdown()
        try {
            ApiClient(url, 1, null).send(API.getMeta())
            fail("expected error")
        } catch (e: ApiError) {
            assertTrue(e.isConnectivityProblem)
        }
    }
}
