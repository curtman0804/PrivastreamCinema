package com.privastreamsolutions.privastreamcinema.ui

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
        val poster: ImageView = view.findViewById(R.id.posterImage)
        val title: TextView = view.findViewById(R.id.titleText)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MediaViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_media_card, parent, false)
        return MediaViewHolder(view)
    }

    override fun onBindViewHolder(holder: MediaViewHolder, position: Int) {
        val item = items[position]
        holder.title.text = item.name

        Glide.with(holder.itemView.context)
            .load(item.poster)
            .centerCrop()
            .placeholder(R.drawable.ic_launcher_foreground)
            .into(holder.poster)

        holder.itemView.setOnClickListener {
            val fragment = MediaDetailsFragment().apply {
                arguments = android.os.Bundle().apply {
                    putSerializable("mediaItem", item)
                }
            }
            activity.supportFragmentManager.beginTransaction()
                .replace(R.id.fragmentContainer, fragment)
                .addToBackStack(null)
                .commit()
        }
    }

    override fun getItemCount(): Int = items.size
}