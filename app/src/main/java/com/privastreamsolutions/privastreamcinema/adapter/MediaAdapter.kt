package com.privastreamsolutions.privastreamcinema.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.MediaItem

class MediaAdapter(
    private val items: List<MediaItem>,
    private val activity: FragmentActivity
) : RecyclerView.Adapter<MediaAdapter.MediaViewHolder>() {

    class MediaViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val poster: ImageView = view.findViewById(R.id.mediaPoster)
        val title: TextView = view.findViewById(R.id.mediaTitle)
        val desc: TextView = view.findViewById(R.id.mediaDescription)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MediaViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_media_tile, parent, false)
        return MediaViewHolder(view)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: MediaViewHolder, position: Int) {
        val item = items[position]

        holder.title.text = item.name
        holder.desc.text = item.description

        Glide.with(activity)
            .load(item.poster)
            .centerCrop()
            .into(holder.poster)

        holder.itemView.setOnClickListener {
            // TODO: Launch playback or details screen
        }
    }
}