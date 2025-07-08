package com.privastreamsolutions.privastreamcinema.network

import com.privastreamsolutions.privastreamcinema.model.AddonManifest
import com.privastreamsolutions.privastreamcinema.model.CatalogResponse
import retrofit2.http.GET
import retrofit2.http.Path

interface CatalogService {
    @GET("manifest.json")
    suspend fun fetchManifest(): AddonManifest

    @GET("catalog/{type}/{id}.json")
    suspend fun getCatalogByType(
        @Path("type") type: String,
        @Path("id") id: String
    ): CatalogResponse
}