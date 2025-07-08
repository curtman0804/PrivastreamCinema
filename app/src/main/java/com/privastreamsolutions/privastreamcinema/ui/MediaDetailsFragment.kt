package com.privastreamsolutions.privastreamcinema.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.MediaItem

class MediaDetailsFragment : Fragment(R.layout.fragment_media_details) {

    private lateinit var poster: ImageView
    private lateinit var title: TextView
    private lateinit var description: TextView
    private lateinit var streamButton: Button

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        poster = view.findViewById(R.id.detailPoster)
        title = view.findViewById(R.id.detailTitle)
        description = view.findViewById(R.id.detailDescription)
        streamButton = view.findViewById(R.id.detailStreamButton)

        val item = arguments?.getSerializable("mediaItem") as? MediaItem ?: return

        title.text = item.name
        description.text = item.description

        Glide.with(requireContext())
            .load(item.poster)
            .centerCrop()
            .placeholder(R.drawable.ic_launcher_foreground)
            .into(poster)

        streamButton.setOnClickListener {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(item.streamUrl)))
        }
    }
}