package com.privastreamsolutions.privastreamcinema.model

import java.io.Serializable

data class MediaItem(
    val name: String,
    val poster: String,
    val description: String,
    val streamUrl: String
) : Serializable
