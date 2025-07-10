package com.privastreamsolutions.privastreamcinema.adapter

import android.app.Activity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.privastreamsolutions.privastreamcinema.R
import com.privastreamsolutions.privastreamcinema.model.MediaItem

class MediaRowAdapter(
    private val items: List<MediaItem>,
    private val activity: Activity
) : RecyclerView.Adapter<MediaRowAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val poster: ImageView = view.findViewById(R.id.posterImage)
        val title: TextView = view.findViewById(R.id.posterTitle)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val layout = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_poster, parent, false)
        return ViewHolder(layout)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val media = items[position]
        holder.title.text = media.name

        Glide.with(activity)
            .load(media.poster)
            .into(holder.poster)

        holder.itemView.setOnClickListener {
            // TODO: Handle stream launching or show media detail
        }
    }

    override fun getItemCount(): Int = items.size
}